import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getServerEnv } from "./server-env";
import { sanitizarPermissoes } from "./permissoes";

/**
 * Ponto crítico de segurança deste arquivo: criar/editar usuários exige a
 * SERVICE ROLE KEY do Supabase (bypassa RLS), que só existe no servidor
 * (via getServerEnv, nunca import.meta.env) e nunca é exposta ao client.
 *
 * Antes de liberar esse poder, revalidamos a permissão no servidor mesmo que
 * a UI já esconda os botões de quem não pode — o accessToken do chamador
 * chega como parâmetro (não é lido de cookie/sessão do server) e é usado com
 * a ANON key para: 1) confirmar que o token é de um usuário autenticado de
 * verdade (auth.getUser) e 2) checar role/permissoes dele na tabela profiles.
 * Passa quem é admin OU tem a permissão 'cadastrar_funcionarios'. Só então o
 * client com a service role key é devolvido, junto com callerIsAdmin — só o
 * admin pode definir cargo/permissões de outra conta.
 */
async function getAdminClient(
  accessToken: string,
): Promise<{ supabaseAdmin: SupabaseClient; callerId: string; callerIsAdmin: boolean }> {
  const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
  const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;
  const serviceRoleKey = await getServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    // Aponta qual variável falta (nomes só, nunca valores).
    const faltando = [
      !supabaseUrl && "VITE_SUPABASE_URL",
      !anonKey && "VITE_SUPABASE_ANON_KEY",
      !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Configuração do Supabase ausente no servidor: ${faltando}.`);
  }

  const supabaseAsCaller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: userData, error: userError } = await supabaseAsCaller.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("Sessão inválida. Faça login novamente.");
  }

  const { data: perfil, error: perfilError } = await supabaseAsCaller
    .from("profiles")
    .select("role, permissoes")
    .eq("id", userData.user.id)
    .single();

  const callerIsAdmin = perfil?.role === "admin";
  const podeGerenciar =
    callerIsAdmin || sanitizarPermissoes(perfil?.permissoes).includes("cadastrar_funcionarios");

  if (perfilError || !podeGerenciar) {
    throw new Error("Você não tem acesso ao cadastro de funcionários.");
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { supabaseAdmin, callerId: userData.user.id, callerIsAdmin };
}

const cargoSchema = {
  role: z.enum(["admin", "funcionario"]).optional(),
  permissoes: z.array(z.string()).optional(),
};

/**
 * Normaliza cargo/permissões conforme quem está chamando. Só o admin define
 * cargo de outra conta; qualquer outro chamador só cria/edita Funcionário
 * padrão (a trigger profiles_guard_cargo no banco reforça isso).
 */
function resolverCargo(
  callerIsAdmin: boolean,
  role: "admin" | "funcionario" | undefined,
  permissoes: string[] | undefined,
): { role: "admin" | "funcionario"; permissoes: string[] } {
  if (!callerIsAdmin) return { role: "funcionario", permissoes: [] };
  if (role === "admin") return { role: "admin", permissoes: [] };
  return { role: "funcionario", permissoes: sanitizarPermissoes(permissoes) };
}

const criarInputSchema = z.object({
  accessToken: z.string().min(1),
  nome: z.string().trim().min(1),
  email: z.string().trim().email(),
  senha: z.string().min(6),
  ...cargoSchema,
});

/** Server function: roda só no servidor (nunca é enviada ao bundle do client). */
export const criarFuncionario = createServerFn({ method: "POST" })
  .validator((data: unknown) => criarInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin, callerIsAdmin } = await getAdminClient(data.accessToken);
    const cargo = resolverCargo(callerIsAdmin, data.role, data.permissoes);

    const { data: novoUsuario, error: criarError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.senha,
      email_confirm: true,
      user_metadata: { nome: data.nome, role: cargo.role },
    });

    if (criarError || !novoUsuario.user) {
      throw new Error(criarError?.message ?? "Não foi possível criar o funcionário.");
    }

    // A trigger handle_new_user já criou a linha em profiles com role padrão;
    // aqui aplicamos o cargo/permissões escolhidos (só admin chega com algo
    // diferente de "funcionário padrão").
    const { error: cargoError } = await supabaseAdmin
      .from("profiles")
      .update({ role: cargo.role, permissoes: cargo.permissoes })
      .eq("id", novoUsuario.user.id);
    if (cargoError) {
      throw new Error(cargoError.message || "Funcionário criado, mas o cargo não foi salvo.");
    }

    return { id: novoUsuario.user.id, nome: data.nome, email: data.email };
  });

const editarInputSchema = z.object({
  accessToken: z.string().min(1),
  userId: z.string().min(1),
  nome: z.string().trim().min(1),
  email: z.string().trim().email(),
  senha: z.union([z.string().min(6), z.literal("")]).optional(),
  ...cargoSchema,
});

export const editarFuncionario = createServerFn({ method: "POST" })
  .validator((data: unknown) => editarInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin, callerIsAdmin } = await getAdminClient(data.accessToken);

    // Só o admin altera cargo; para os demais o update de profiles nem toca
    // em role/permissoes (mantém o que já está gravado).
    const cargo = callerIsAdmin ? resolverCargo(true, data.role, data.permissoes) : null;

    const authUpdate: {
      email: string;
      user_metadata: Record<string, unknown>;
      password?: string;
    } = {
      email: data.email,
      user_metadata: { nome: data.nome, ...(cargo ? { role: cargo.role } : {}) },
    };
    // Senha é opcional na edição: só troca se o admin preencheu um valor novo.
    if (data.senha) authUpdate.password = data.senha;

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      data.userId,
      authUpdate,
    );
    if (authError) {
      throw new Error(authError.message || "Não foi possível atualizar o funcionário.");
    }

    const perfilUpdate: Record<string, unknown> = { nome: data.nome, email: data.email };
    if (cargo) {
      perfilUpdate["role"] = cargo.role;
      perfilUpdate["permissoes"] = cargo.permissoes;
    }

    const { error: perfilError } = await supabaseAdmin
      .from("profiles")
      .update(perfilUpdate)
      .eq("id", data.userId);
    if (perfilError) {
      throw new Error(perfilError.message || "Não foi possível atualizar o perfil.");
    }

    return { id: data.userId, nome: data.nome, email: data.email };
  });

const excluirInputSchema = z.object({
  accessToken: z.string().min(1),
  userId: z.string().min(1),
});

export const excluirFuncionario = createServerFn({ method: "POST" })
  .validator((data: unknown) => excluirInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin, callerId } = await getAdminClient(data.accessToken);

    // Um admin não pode excluir a própria conta por este caminho.
    if (data.userId === callerId) {
      throw new Error("Você não pode excluir a sua própria conta.");
    }

    // profiles.id referencia auth.users(id) ON DELETE CASCADE, então remover o
    // usuário do Auth já apaga o perfil correspondente.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) {
      throw new Error(error.message || "Não foi possível excluir o funcionário.");
    }

    return { id: data.userId };
  });
