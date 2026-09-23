import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Fuso da loja — fixo, não depende do fuso do dispositivo/servidor. */
export const FUSO_LOJA = "America/Sao_Paulo";

/**
 * Mesmo instante que `data`, mas com os campos UTC iguais ao relógio de parede
 * no fuso da loja (ex.: 15:17 em Brasília vira `getUTCHours() === 15`). Usado
 * pra extrair hora/minuto "de Brasília" com `getUTC*()` em vez de `get*()` —
 * assim o cálculo de prazo/atraso não muda conforme o fuso do navegador ou do
 * servidor (SSR) que está rodando o código, só o horário real do evento.
 */
export function paraFusoLoja(data: Date): Date {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_LOJA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(data);
  const val = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "0";
  return new Date(
    Date.UTC(
      Number(val("year")),
      Number(val("month")) - 1,
      Number(val("day")),
      Number(val("hour")) % 24, // Intl pode devolver "24" à meia-noite em vez de "00"
      Number(val("minute")),
      Number(val("second")),
    ),
  );
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

/** Último dia do mês (28..31) da data informada. */
export function ultimoDiaDoMes(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/** Diferença em dias inteiros entre duas datas (b - a), ignorando horário. */
export function diasEntre(a: Date, b: Date): number {
  const ma = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const mb = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((mb - ma) / 86_400_000);
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
