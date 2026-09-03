import { supabase, type ChecklistExecucaoRow } from "@/lib/supabase";
import { isoDoDia } from "@/lib/utils";
import { itemRodaNoDia } from "@/lib/recorrencia";
import { limiteDaRotina, type Checklist } from "@/lib/g-check-store";

const ORDEM_TURNO: Record<string, number> = { Manhã: 0, Tarde: 1, Noite: 2 };

/** Turnos + primeiro horário de início a partir dos itens do snapshot. */
export function agendaDoSnapshot(e: ChecklistExecucaoRow): { turno: string; horario: string } {
  const inicios = (e.itens ?? [])
    .map((i) => i.horario_inicio ?? undefined)
    .filter((v): v is string => !!v)
    .sort();
  const turnos = [
    ...new Set((e.itens ?? []).map((i) => i.turno ?? undefined).filter((v): v is string => !!v)),
  ].sort((a, b) => (ORDEM_TURNO[a] ?? 9) - (ORDEM_TURNO[b] ?? 9));
  return { turno: turnos.join(" · "), horario: (inicios[0] ?? "").slice(0, 5) };
}

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
    .order("nome", { ascending: true })
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
        .map((e) => ({ e, agenda: agendaDoSnapshot(e) }))
        .sort(
          (a, b) =>
            a.agenda.horario.localeCompare(b.agenda.horario) || a.e.nome.localeCompare(b.e.nome),
        )
        .map(({ e, agenda }) => ({
          checklistId: e.checklist_id,
          nome: e.nome,
          setor: e.setor,
          turno: agenda.turno,
          horario: agenda.horario,
          total: e.total_itens,
          feitos: e.itens_concluidos,
          status: e.completa ? ("completa" as const) : ("incompleta" as const),
        }));
    } else {
      const diaRef = new Date(cursor);
      const agoraMin = new Date().getHours() * 60 + new Date().getMinutes();
      entradas = ativas
        .map((c) => ({ c, itensDoDia: c.itens.filter((i) => itemRodaNoDia(i, diaRef)) }))
        .filter(({ itensDoDia }) => itensDoDia.length > 0)
        .sort(
          (a, b) =>
            (a.c.horarioInicio ?? "99:99").localeCompare(b.c.horarioInicio ?? "99:99") ||
            a.c.nome.localeCompare(b.c.nome),
        )
        .map(({ c, itensDoDia }) => {
          const total = itensDoDia.length;
          const feitos = itensDoDia.filter((i) => i.status === "concluido").length;
          const completo = total > 0 && feitos === total;
          const limiteStr = limiteDaRotina(c);
          const limite = limiteStr
            ? Number(limiteStr.slice(0, 2)) * 60 + Number(limiteStr.slice(3, 5))
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
            turno: c.turnos.join(" · "),
            horario: c.horarioInicio ?? "",
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
