import { supabase, type ChecklistExecucaoRow } from "@/lib/supabase";
import { isoDoDia } from "@/lib/utils";
import type { Checklist } from "@/lib/g-check-store";

export const HISTORICO_QUERY_KEY = ["historico"] as const;

/** Execuções registradas no intervalo [deISO, ateISO] (inclusive). */
export async function fetchExecucoes(
  deISO: string,
  ateISO: string,
): Promise<ChecklistExecucaoRow[]> {
  const { data, error } = await supabase
    .from("checklist_execucoes")
    .select("*")
    .gte("data", deISO)
    .lte("data", ateISO)
    .order("data", { ascending: true })
    .order("horario", { ascending: true })
    .returns<ChecklistExecucaoRow[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Fecha o(s) dia(s) pendente(s) e reinicia as checklists. Idempotente no
 * servidor — chamar à toa (ao abrir o app / no foco) é barato quando já rodou.
 */
export async function rolloverPendente(): Promise<void> {
  const { error } = await supabase.rpc("rollover_pendente");
  if (error) throw error;
}

export type StatusHistorico =
  | "futura"
  | "naoIniciada"
  | "hoje"
  | "incompleta"
  | "completa";

export interface EntradaHistorico {
  checklistId: string;
  nome: string;
  setor: string;
  turno: string;
  /** "HH:MM". */
  horario: string;
  total: number;
  feitos: number;
  status: StatusHistorico;
}

export interface DiaHistorico {
  iso: string;
  data: Date;
  /** Dia marcado como sem expediente (dias_desativados) — não teve rotina. */
  pausado: boolean;
  entradas: EntradaHistorico[];
}

/**
 * Combina o que já aconteceu (checklist_execucoes) com o estado ao vivo de hoje
 * e o agendamento futuro (checklist.diasSemana) numa lista dia a dia:
 *
 * - passado  -> a partir do snapshot: completa (verde) ou incompleta (vermelho)
 * - hoje     -> ao vivo: tudo feito = completa (verde); nada feito = não iniciada
 *              (cinza); algum item feito = em andamento (azul)
 * - futuro   -> agendada (cinza)
 * - pausado  -> dia sem expediente, sem entradas
 */
export function montarHistorico(opts: {
  de: Date;
  ate: Date;
  hojeISO: string;
  execucoes: ChecklistExecucaoRow[];
  checklists: Checklist[];
  diasDesativados: Set<string>;
}): DiaHistorico[] {
  const { de, ate, hojeISO, execucoes, checklists, diasDesativados } = opts;

  const exPorDia = new Map<string, ChecklistExecucaoRow[]>();
  for (const e of execucoes) {
    const arr = exPorDia.get(e.data);
    if (arr) arr.push(e);
    else exPorDia.set(e.data, [e]);
  }

  const ativas = checklists.filter((c) => c.ativo);
  const dias: DiaHistorico[] = [];

  const cursor = new Date(de.getFullYear(), de.getMonth(), de.getDate());
  const fim = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate());

  while (cursor <= fim) {
    const iso = isoDoDia(cursor);
    const pausado = diasDesativados.has(iso);
    let entradas: EntradaHistorico[] = [];

    if (pausado) {
      entradas = [];
    } else if (iso < hojeISO) {
      entradas = (exPorDia.get(iso) ?? [])
        .slice()
        .sort((a, b) => a.horario.localeCompare(b.horario))
        .map((e) => ({
          checklistId: e.checklist_id,
          nome: e.nome,
          setor: e.setor,
          turno: e.turno,
          horario: e.horario.slice(0, 5),
          total: e.total_itens,
          feitos: e.itens_concluidos,
          status: e.completa ? ("completa" as const) : ("incompleta" as const),
        }));
    } else {
      const dow = cursor.getDay();
      const agoraMin = new Date().getHours() * 60 + new Date().getMinutes();
      entradas = ativas
        .filter((c) => c.diasSemana.includes(dow))
        .slice()
        .sort((a, b) => a.horario.localeCompare(b.horario))
        .map((c) => {
          const total = c.itens.length;
          const feitos = c.itens.filter((i) => i.status === "concluido").length;
          const completo = total > 0 && feitos === total;
          const limite = c.tempoLimite
            ? Number(c.tempoLimite.slice(0, 2)) * 60 + Number(c.tempoLimite.slice(3, 5))
            : null;
          const atrasada = !completo && limite !== null && agoraMin > limite;
          const status: StatusHistorico =
            iso > hojeISO
              ? "futura"
              : completo
                ? "completa"
                : atrasada
                  ? "incompleta"
                  : feitos === 0
                    ? "naoIniciada"
                    : "hoje";
          return {
            checklistId: c.id,
            nome: c.nome,
            setor: c.setor,
            turno: c.turno,
            horario: c.horario,
            total,
            feitos,
            status,
          };
        });
    }

    dias.push({ iso, data: new Date(cursor), pausado, entradas });
    cursor.setDate(cursor.getDate() + 1);
  }

  return dias;
}
