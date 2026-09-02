import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/auth-store";

export const PROFILES_QUERY_KEY = ["profiles"] as const;

export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome, email, role")
    .order("nome", { ascending: true })
    .returns<Profile[]>();
  if (error) throw error;
  return data ?? [];
}
