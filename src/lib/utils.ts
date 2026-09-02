import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** ISO local "yyyy-MM-dd" (sem conversão de fuso) a partir de um Date. */
export function isoDoDia(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Date à meia-noite local a partir de um ISO "yyyy-MM-dd". */
export function dataDoIso(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/**
 * Grade de um mês para calendário: começa no domingo anterior (ou no próprio)
 * dia 1 e vai até fechar a última semana, então toda célula é um Date real
 * (as de "fora do mês" inclusas).
 */
export function celulasDoMes(ref: Date): Date[] {
  const ano = ref.getFullYear();
  const mes = ref.getMonth();
  const offset = new Date(ano, mes, 1).getDay();
  const total = Math.ceil((offset + new Date(ano, mes + 1, 0).getDate()) / 7) * 7;
  return Array.from({ length: total }, (_, i) => new Date(ano, mes, i - offset + 1));
}
