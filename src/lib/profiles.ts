import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/auth-store";
import { sanitizarPermissoes } from "@/lib/permissoes";

export const PROFILES_QUERY_KEY = ["profiles"] as const;

export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome, email, role, permissoes")
    .order("nome", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...(row as Omit<Profile, "permissoes">),
    permissoes: sanitizarPermissoes((row as { permissoes?: string[] }).permissoes),
  }));
}

export const NOMES_ADMIN_QUERY_KEY = ["nomes-admin"] as const;

/**
 * Só os nomes das contas admin (via RPC `nomes_admin`, security definer —
 * ver migration 20260916120000) — usado para esconder de personalizados com
 * 'consultar_checklists_outros'/'marcar_checklists_outros' as rotinas cujo
 * responsável é um admin, mesmo sem acesso à tabela `profiles` inteira.
 */
export async function fetchNomesAdmin(): Promise<string[]> {
  const { data, error } = await supabase.rpc("nomes_admin");
  if (error) throw error;
  return (data ?? []).map((row: { nome: string }) => row.nome);
}
