import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-store";
import { supabase, type DiaDesativadoRow } from "@/lib/supabase";
import { isoDoDia } from "@/lib/utils";

export const DIAS_DESATIVADOS_QUERY_KEY = ["dias-desativados"] as const;

/** Datas (ISO "yyyy-MM-dd") marcadas como "sem expediente" — feriados, etc. */
export async function fetchDiasDesativados(): Promise<string[]> {
  const { data, error } = await supabase
    .from("dias_desativados")
    .select("data")
    .returns<Pick<DiaDesativadoRow, "data">[]>();
  if (error) throw error;
  return (data ?? []).map((r) => r.data);
}

/** Desativa (pausa) as rotinas de um dia. `criadoPor` = id do admin logado. */
export async function desativarDia(iso: string, criadoPor: string | null) {
  const { error } = await supabase
    .from("dias_desativados")
    .insert({ data: iso, criado_por: criadoPor });
  if (error) throw error;
}

/** Reativa as rotinas do dia (remove a marca). */
export async function reativarDia(iso: string) {
  const { error } = await supabase.from("dias_desativados").delete().eq("data", iso);
  if (error) throw error;
}

/**
 * Lista completa das datas sem expediente (ISO "yyyy-MM-dd"). Base para o
 * calendário de personalização no dashboard e para os marcadores no histórico.
 */
export function useDiasDesativados() {
  const { session } = useAuth();
  const query = useQuery({
    queryKey: DIAS_DESATIVADOS_QUERY_KEY,
    queryFn: fetchDiasDesativados,
    enabled: !!session,
  });
  const datas = query.data ?? [];
  return {
    datas,
    datasSet: new Set(datas),
    isLoading: query.isLoading,
  };
}

/**
 * Estado compartilhado de "hoje está pausado?". Usado no dashboard (não cobra as
 * pendências) e na página de checklists (trava a marcação dos itens).
 */
export function useHojeDesativado() {
  const { datasSet } = useDiasDesativados();
  const hojeISO = isoDoDia(new Date());
  return {
    hojeISO,
    hojeDesativado: datasSet.has(hojeISO),
  };
}
