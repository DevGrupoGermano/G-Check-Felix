import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"];
const supabaseAnonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"];

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY precisam estar definidas (arquivo .env).",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Bucket dos anexos de comprovação das tarefas (ver migration 20260901121000). */
export const BUCKET_ANEXOS = "checklist-fotos";

/** Um anexo de comprovação (foto, vídeo ou documento) de um item de checklist. */
export interface Anexo {
  /** URL pública no Storage. */
  url: string;
  /** MIME do arquivo (ex.: "image/jpeg", "video/mp4", "application/pdf"). */
  tipo: string;
  /** Nome original do arquivo, para exibição. */
  nome: string;
}

export interface ChecklistRow {
  id: string;
  nome: string;
  setor: string;
  turno: string;
  horario: string;
  ativo: boolean;
  /** "HH:MM:SS" ou null — horário limite para concluir a rotina. */
  tempo_limite: string | null;
}

/** Modo de recorrência de uma atividade (item). */
export type RecorrenciaRow = "semanal" | "quinzenal" | "mensal";

export interface ChecklistItemRow {
  id: string;
  checklist_id: string;
  titulo: string;
  detalhe: string | null;
  responsavel: string;
  status: string;
  posicao: number;
  /** Quantos anexos são obrigatórios para concluir (0 = opcional). */
  min_anexos: number;
  /** Anexos enviados no dia; limpos no rollover. */
  anexos: Anexo[];
  /** Modo de recorrência da atividade. */
  recorrencia: RecorrenciaRow;
  /** Dias da semana (0=domingo..6=sábado) — usado quando recorrencia = 'semanal'. */
  dias_semana: number[];
  /** Data de início "yyyy-MM-dd" — usado quando recorrencia = 'quinzenal'/'mensal'. */
  inicio: string | null;
}

export interface SetorRow {
  id: string;
  nome: string;
  descricao: string | null;
}

export interface DiaDesativadoRow {
  /** ISO "yyyy-MM-dd" (tipo date do Postgres). */
  data: string;
  criado_por: string | null;
  created_at: string;
}

/** Snapshot de uma checklist num dia — gravado no rollover diário. */
export interface ChecklistExecucaoRow {
  id: string;
  checklist_id: string;
  /** ISO "yyyy-MM-dd". */
  data: string;
  nome: string;
  setor: string;
  turno: string;
  /** "HH:MM:SS". */
  horario: string;
  total_itens: number;
  itens_concluidos: number;
  completa: boolean;
  itens: {
    titulo: string;
    responsavel: string;
    status: string;
    min_anexos?: number;
    anexos?: Anexo[];
  }[];
  registrado_em: string;
}
