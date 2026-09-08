/**
 * Catálogo canônico de permissões do cargo "Personalizado".
 *
 * A checklist do formulário de funcionários (src/routes/funcionarios.tsx) e o
 * gate de acesso do client (src/lib/auth-store.tsx -> temAcesso) leem daqui.
 * As policies de RLS no Supabase usam as mesmas chaves via public.tem_acesso()
 * (ver supabase/migrations/20260908160000_cargos_permissoes.sql).
 */

export const PERMISSOES = [
  {
    chave: "cadastrar_funcionarios",
    rotulo: "Cadastro de funcionários",
    descricao: "Abrir a tela Funcionários e criar, editar ou excluir contas.",
  },
  {
    chave: "criar_checklist",
    rotulo: "Criar e editar checklists",
    descricao: "Criar, editar e excluir rotinas e suas atividades, incluindo dias de folga.",
  },
  {
    chave: "consultar_checklists_outros",
    rotulo: "Consultar checklists dos demais",
    descricao: "Ver todas as rotinas (somente leitura), não apenas as próprias tarefas.",
  },
  {
    chave: "marcar_checklists_outros",
    rotulo: "Marcar checklists dos demais",
    descricao:
      "Concluir, anexar e responder atividades de rotinas de que não é responsável, sem poder editar a checklist.",
  },
  {
    chave: "ver_historico",
    rotulo: "Visualizar histórico",
    descricao: "Abrir a tela Histórico e os registros de dias já fechados.",
  },
  {
    chave: "pausar_dias",
    rotulo: "Pausar rotinas (feriado)",
    descricao: "Marcar um dia sem expediente para pausar todas as rotinas.",
  },
  {
    chave: "reabrir_rotina",
    rotulo: "Reabrir tarefa concluída",
    descricao: "Desmarcar uma atividade já concluída e reabrir a rotina do dia.",
  },
] as const;

export type Permissao = (typeof PERMISSOES)[number]["chave"];

const CHAVES_VALIDAS = new Set<string>(PERMISSOES.map((p) => p.chave));

/** Mantém só chaves conhecidas, sem repetição — usado ao ler/gravar do banco. */
export function sanitizarPermissoes(entrada: readonly string[] | null | undefined): Permissao[] {
  if (!entrada) return [];
  const vistos = new Set<Permissao>();
  for (const item of entrada) {
    if (CHAVES_VALIDAS.has(item)) vistos.add(item as Permissao);
  }
  return [...vistos];
}
