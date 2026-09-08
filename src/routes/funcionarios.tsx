import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { ChevronRight, Pencil, Plus, Settings2, ShieldCheck, Trash2, User } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { useAuth, type Profile } from "@/lib/auth-store";
import { criarFuncionario, editarFuncionario, excluirFuncionario } from "@/lib/employees-fn";
import { fetchProfiles, PROFILES_QUERY_KEY } from "@/lib/profiles";
import { resumoDe, tarefasPorFuncionario, useGCheck } from "@/lib/g-check-store";
import { PERMISSOES } from "@/lib/permissoes";
import type { Control, FieldValues, Path } from "react-hook-form";

export const Route = createFileRoute("/funcionarios")({
  head: () => ({
    meta: [{ title: "Funcionários — G-check" }],
  }),
  component: FuncionariosPage,
});

/**
 * "Cargo" é um conceito só de interface: no banco a conta continua sendo
 * role='admin' ou role='funcionario' (+ permissoes). Aqui separamos em três
 * opções pra ficar claro na tela — "Personalizado" é role='funcionario' com
 * permissoes escolhidas a dedo (ver src/lib/permissoes.ts e a migration
 * 20260908160000_cargos_permissoes.sql).
 */
const CARGO_OPCOES = [
  {
    valor: "funcionario",
    rotulo: "Funcionário",
    descricao: "Acesso padrão: só as próprias tarefas do dia.",
  },
  {
    valor: "personalizado",
    rotulo: "Personalizado",
    descricao: "Escolha exatamente o que essa conta pode acessar.",
  },
  {
    valor: "admin",
    rotulo: "Administrador",
    descricao: "Acesso total ao sistema, sem restrições.",
  },
] as const;

type CargoValor = (typeof CARGO_OPCOES)[number]["valor"];

function cargoDoPerfil(p: Profile): CargoValor {
  if (p.role === "admin") return "admin";
  return p.permissoes.length > 0 ? "personalizado" : "funcionario";
}

const cargoRotulo: Record<CargoValor, string> = {
  admin: "Administrador",
  personalizado: "Personalizado",
  funcionario: "Funcionário",
};

const cargoSchemaFields = {
  cargo: z.enum(["admin", "funcionario", "personalizado"]),
  permissoes: z.array(z.string()),
};

/** Cargo "Personalizado" sem nenhuma permissão marcada equivale, na prática, a
 * Funcionário padrão — bloqueia o submit pra evitar essa confusão na lista. */
function refinoCargo(v: { cargo: CargoValor; permissoes: string[] }, ctx: z.RefinementCtx) {
  if (v.cargo === "personalizado" && v.permissoes.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["permissoes"],
      message: "Selecione ao menos uma permissão.",
    });
  }
}

/** Campos de cargo/permissões — só renderizados no formulário quando quem está
 * cadastrando é admin de verdade (quem só tem 'cadastrar_funcionarios' cria e
 * edita exclusivamente contas Funcionário padrão). */
function CargoFields<T extends FieldValues & { cargo: CargoValor; permissoes: string[] }>({
  control,
}: {
  control: Control<T>;
}) {
  const cargoPath = "cargo" as Path<T>;
  const permissoesPath = "permissoes" as Path<T>;
  const cargoAtual = useWatch({ control, name: cargoPath }) as CargoValor;
  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <FormField
        control={control}
        name={cargoPath}
        render={({ field }) => (
          <FormItem className="space-y-2">
            <FormLabel>Cargo</FormLabel>
            <FormControl>
              <RadioGroup
                value={field.value as CargoValor}
                onValueChange={field.onChange}
                className="grid gap-2"
              >
                {CARGO_OPCOES.map((opcao) => (
                  <label
                    key={opcao.valor}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition-colors",
                      field.value === opcao.valor
                        ? "border-primary bg-primary/5"
                        : "border-input hover:border-primary/50",
                    )}
                  >
                    <RadioGroupItem value={opcao.valor} className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">{opcao.rotulo}</span>
                      <span className="block text-xs text-muted-foreground">{opcao.descricao}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </FormControl>
          </FormItem>
        )}
      />

      {cargoAtual === "personalizado" && (
        <FormField
          control={control}
          name={permissoesPath}
          render={({ field }) => {
            const selecionadas = field.value as string[];
            return (
              <FormItem className="space-y-2 border-t border-border pt-3">
                <FormLabel>Permissões</FormLabel>
                <div className="space-y-2">
                  {PERMISSOES.map((permissao) => {
                    const marcada = selecionadas.includes(permissao.chave);
                    return (
                      <label
                        key={permissao.chave}
                        className="flex cursor-pointer items-start gap-2 rounded-lg p-1.5 hover:bg-muted/60"
                      >
                        <Checkbox
                          checked={marcada}
                          onCheckedChange={(checked) =>
                            field.onChange(
                              checked
                                ? [...selecionadas, permissao.chave]
                                : selecionadas.filter((v) => v !== permissao.chave),
                            )
                          }
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block text-sm font-medium">{permissao.rotulo}</span>
                          <span className="block text-xs text-muted-foreground">
                            {permissao.descricao}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <FormMessage />
              </FormItem>
            );
          }}
        />
      )}
    </div>
  );
}

/** Deriva { role, permissoes } a partir do cargo escolhido na tela. */
function cargoParaPayload(cargo: CargoValor, permissoes: string[]) {
  if (cargo === "admin") return { role: "admin" as const, permissoes: [] as string[] };
  if (cargo === "personalizado") return { role: "funcionario" as const, permissoes };
  return { role: "funcionario" as const, permissoes: [] as string[] };
}

const funcionarioSchema = z
  .object({
    nome: z.string().trim().min(1, "Informe o nome."),
    email: z.string().trim().min(1, "Informe o e-mail.").email("E-mail inválido."),
    senha: z.string().min(6, "A senha deve ter ao menos 6 caracteres."),
    ...cargoSchemaFields,
  })
  .superRefine(refinoCargo);

type FuncionarioValues = z.infer<typeof funcionarioSchema>;

function NovoFuncionarioDialog() {
  const { session, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  // Liga o botão "Cadastrar" (fora da tag <form>, no rodapé fixo) ao form via
  // atributo HTML "form" — dispensa recuperar o formulário por ref.
  const formId = React.useId();

  const form = useForm<FuncionarioValues>({
    resolver: zodResolver(funcionarioSchema),
    defaultValues: { nome: "", email: "", senha: "", cargo: "funcionario", permissoes: [] },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    form.reset();
  }

  async function onSubmit(values: FuncionarioValues) {
    if (!session) return;
    setEnviando(true);
    try {
      // Só um admin de verdade escolhe cargo/permissões — os demais que têm
      // 'cadastrar_funcionarios' sempre criam Funcionário padrão (o server
      // reforça isso mesmo se o payload chegasse alterado).
      const cargo = isAdmin ? cargoParaPayload(values.cargo, values.permissoes) : undefined;
      await criarFuncionario({
        data: {
          accessToken: session.access_token,
          nome: values.nome,
          email: values.email,
          senha: values.senha,
          ...(cargo ? { role: cargo.role, permissoes: cargo.permissoes } : {}),
        },
      });
      toast.success("Funcionário cadastrado.");
      queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cadastrar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> Novo funcionário
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>Novo funcionário</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <Form {...form}>
            <form id={formId} onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex.: Ana Paula" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="ana@empresa.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="senha"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha provisória</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Ao menos 6 caracteres" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isAdmin && <CargoFields control={form.control} />}
            </form>
          </Form>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={enviando}>
            {enviando ? "Cadastrando…" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const editarFuncionarioSchema = z
  .object({
    nome: z.string().trim().min(1, "Informe o nome."),
    email: z.string().trim().min(1, "Informe o e-mail.").email("E-mail inválido."),
    senha: z.union([z.string().min(6, "A senha deve ter ao menos 6 caracteres."), z.literal("")]),
    ...cargoSchemaFields,
  })
  .superRefine(refinoCargo);

type EditarFuncionarioValues = z.infer<typeof editarFuncionarioSchema>;

function valoresEditar(profile: Profile): EditarFuncionarioValues {
  return {
    nome: profile.nome,
    email: profile.email,
    senha: "",
    cargo: cargoDoPerfil(profile),
    permissoes: [...profile.permissoes],
  };
}

function EditarFuncionarioDialog({ profile }: { profile: Profile }) {
  const { session, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  // Liga o botão "Salvar alterações" (fora da tag <form>, no rodapé fixo) ao
  // form via atributo HTML "form" — dispensa recuperar o formulário por ref.
  const formId = React.useId();

  const form = useForm<EditarFuncionarioValues>({
    resolver: zodResolver(editarFuncionarioSchema),
    defaultValues: valoresEditar(profile),
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    form.reset(valoresEditar(profile));
  }

  async function onSubmit(values: EditarFuncionarioValues) {
    if (!session) return;
    setEnviando(true);
    try {
      // Só o admin altera cargo; para os demais o server function ignora
      // esses campos e mantém o que já está gravado.
      const cargo = isAdmin ? cargoParaPayload(values.cargo, values.permissoes) : undefined;
      await editarFuncionario({
        data: {
          accessToken: session.access_token,
          userId: profile.id,
          nome: values.nome,
          email: values.email,
          senha: values.senha,
          ...(cargo ? { role: cargo.role, permissoes: cargo.permissoes } : {}),
        },
      });
      toast.success("Funcionário atualizado.");
      queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Editar ${profile.nome}`}
        >
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>Editar funcionário</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <Form {...form}>
            <form id={formId} onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex.: Ana Paula" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="ana@empresa.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="senha"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nova senha (opcional)</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Deixe em branco para manter a atual"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isAdmin && <CargoFields control={form.control} />}
            </form>
          </Form>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExcluirFuncionarioButton({ profile }: { profile: Profile }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  async function onConfirm() {
    if (!session) return;
    try {
      await excluirFuncionario({
        data: { accessToken: session.access_token, userId: profile.id },
      });
      toast.success("Funcionário excluído.");
      queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir.");
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Excluir ${profile.nome}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir “{profile.nome}”?</AlertDialogTitle>
          <AlertDialogDescription>
            A conta de {profile.email} e o acesso ao G-check serão removidos. Não dá para desfazer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function FuncionariosPage() {
  const { isAdmin, temAcesso, isLoading: authLoading, session } = useAuth();
  // Acesso à tela: admin sempre; quem só tem 'cadastrar_funcionarios' também
  // entra, mas só cria/edita contas Funcionário padrão (cargo é admin-only,
  // ver isAdmin dentro dos dialogs de Novo/Editar).
  const podeGerenciar = isAdmin || temAcesso("cadastrar_funcionarios");
  const { checklists } = useGCheck();
  // O resumo de pendências de cada funcionário considera só as rotinas que rodam
  // hoje: a marca de "pendente" aparece quando a pessoa tem tarefa do dia ainda
  // não concluída.
  const porFuncionario = React.useMemo(
    () => tarefasPorFuncionario(checklists, new Date()),
    [checklists],
  );
  const query = useQuery({
    queryKey: PROFILES_QUERY_KEY,
    queryFn: fetchProfiles,
    enabled: podeGerenciar,
  });

  if (authLoading) return null;

  if (!podeGerenciar) {
    return (
      <AppShell title="Funcionários">
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Você não tem acesso ao cadastro de funcionários.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Funcionários" subtitle="Contas com acesso ao G-check">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {query.data
              ? `${query.data.length} ${query.data.length === 1 ? "funcionário" : "funcionários"}`
              : null}
          </span>
          <NovoFuncionarioDialog />
        </div>

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando funcionários…</p>
        )}
        {query.isError && (
          <p className="text-sm text-destructive">Não foi possível carregar os funcionários.</p>
        )}

        {query.data && (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-sm">
            {query.data.map((p) => {
              const resumo = resumoDe(porFuncionario, p.nome);
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 p-4">
                  <Link
                    to="/checklists"
                    search={{ funcionarios: [p.nome] }}
                    title={`Ver checklists de ${p.nome}`}
                    className="group -m-1 flex min-w-0 items-center gap-3 rounded-lg p-1 transition-colors hover:bg-muted/60"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <User className="size-4.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium group-hover:text-primary">
                        {p.nome}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    {resumo.total > 0 && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "border-transparent",
                          resumo.pendentes > 0
                            ? "bg-chart-4/20 text-chart-4"
                            : "bg-primary/12 text-primary",
                        )}
                        title={`${resumo.feitos} de ${resumo.total} tarefas concluídas`}
                      >
                        {resumo.pendentes > 0
                          ? `${resumo.pendentes} pendente${resumo.pendentes > 1 ? "s" : ""}`
                          : "em dia"}
                      </Badge>
                    )}
                    {(() => {
                      const cargo = cargoDoPerfil(p);
                      return (
                        <Badge
                          variant="outline"
                          className={cn(
                            "gap-1 border-transparent",
                            cargo === "admin"
                              ? "bg-primary/12 text-primary"
                              : cargo === "personalizado"
                                ? "bg-chart-4/20 text-chart-4"
                                : "bg-muted text-muted-foreground",
                          )}
                          title={
                            cargo === "personalizado"
                              ? p.permissoes
                                  .map((c) => PERMISSOES.find((perm) => perm.chave === c)?.rotulo)
                                  .filter(Boolean)
                                  .join(", ")
                              : undefined
                          }
                        >
                          {cargo === "admin" && <ShieldCheck className="size-3" />}
                          {cargo === "personalizado" && <Settings2 className="size-3" />}
                          {cargoRotulo[cargo]}
                        </Badge>
                      );
                    })()}
                    <EditarFuncionarioDialog profile={p} />
                    {p.id !== session?.user.id && <ExcluirFuncionarioButton profile={p} />}
                  </div>
                </li>
              );
            })}
            {query.data.length === 0 && (
              <li className="p-8 text-center text-sm text-muted-foreground">
                Nenhum funcionário cadastrado ainda.
              </li>
            )}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
