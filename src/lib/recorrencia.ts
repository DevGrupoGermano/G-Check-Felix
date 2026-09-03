import { dataDoIso, diasEntre, ultimoDiaDoMes } from "@/lib/utils";

/**
 * Recorrência de uma atividade (item de checklist). Vive por item — não por
 * rotina. Módulo sem dependência do store para não criar ciclo de imports
 * (historico.ts também usa `itemRodaNoDia`).
 */
export const recorrencias = ["semanal", "quinzenal", "mensal"] as const;
export type Recorrencia = (typeof recorrencias)[number];

/** Campos que definem quando a atividade roda. */
export interface RecorrenciaConfig {
  recorrencia: Recorrencia;
  /** Índices de Date.getDay() (0 = domingo) — usados quando recorrencia = "semanal". */
  diasSemana: number[];
  /** Data de início "yyyy-MM-dd" — usada quando recorrencia = "quinzenal"/"mensal". */
  inicio: string | null;
}

/**
 * A atividade está programada para rodar nesta data?
 *  - semanal   -> o dia da semana está no conjunto `diasSemana`;
 *  - quinzenal -> a data é `inicio` ou um múltiplo de 14 dias depois;
 *  - mensal    -> a data cai no mesmo dia do mês de `inicio` (mês curto -> último
 *                 dia do mês), a partir de `inicio`.
 */
export function itemRodaNoDia(item: RecorrenciaConfig, data: Date = new Date()): boolean {
  if (item.recorrencia === "semanal") {
    return item.diasSemana.includes(data.getDay());
  }
  if (!item.inicio) return false;
  const inicio = dataDoIso(item.inicio);
  const delta = diasEntre(inicio, data);
  if (delta < 0) return false;
  if (item.recorrencia === "quinzenal") return delta % 14 === 0;
  // mensal: casa o dia do mês, com "clamp" para meses mais curtos que inicio.
  return data.getDate() === Math.min(inicio.getDate(), ultimoDiaDoMes(data));
}
