import { supabase, type SetorRow } from "@/lib/supabase";

export const SETORES_QUERY_KEY = ["setores"] as const;

export interface Setor {
  id: string;
  nome: string;
  descricao: string | null;
}

export interface SetorInput {
  nome: string;
  descricao: string;
}

/** Gera um id legível a partir do nome (usado como PK do setor no Supabase). */
function slugify(texto: string) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function fetchSetores(): Promise<Setor[]> {
  const { data, error } = await supabase
    .from("setores")
    .select("id, nome, descricao")
    .order("nome", { ascending: true })
    .returns<SetorRow[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Cria um setor. O id é o slug do nome; se já existir (mesmo nome usado antes),
 * acrescenta um sufixo numérico até achar um id livre. "idsExistentes" vem do
 * cache do React Query para evitar uma ida extra ao banco só para checar colisão.
 */
export async function criarSetor(input: SetorInput, idsExistentes: string[]) {
  const base = slugify(input.nome) || "setor";
  let id = base;
  let sufixo = 2;
  while (idsExistentes.includes(id)) id = `${base}-${sufixo++}`;

  const { error } = await supabase.from("setores").insert({
    id,
    nome: input.nome,
    descricao: input.descricao.trim() || null,
  });
  if (error) throw error;
}

export async function editarSetor(id: string, input: SetorInput) {
  const { error } = await supabase
    .from("setores")
    .update({ nome: input.nome, descricao: input.descricao.trim() || null })
    .eq("id", id);
  if (error) throw error;
}

export async function excluirSetor(id: string) {
  const { error } = await supabase.from("setores").delete().eq("id", id);
  if (error) throw error;
}
