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
