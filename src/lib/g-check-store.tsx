import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BUCKET_ANEXOS,
  supabase,
  type Anexo,
  type ChecklistItemRow,
  type ChecklistRow,
} from "@/lib/supabase";
import { useAuth } from "@/lib/auth-store";
import { HISTORICO_QUERY_KEY, rolloverPendente } from "@/lib/historico";

export type ItemStatus = "pendente" | "concluido";

export const turnos = ["Manhã", "Tarde", "Noite"] as const;
export type Turno = (typeof turnos)[number];

/**
 * Dias da semana em que a rotina roda. O valor é o índice JS de Date.getDay()
 * (0 = domingo … 6 = sábado); "inicial" é o rótulo do botão no formulário,
 * na ordem D S T Q Q S S.
 */
export const diasDaSemana = [
  { valor: 0, inicial: "D", nome: "Domingo" },
  { valor: 1, inicial: "S", nome: "Segunda" },
  { valor: 2, inicial: "T", nome: "Terça" },
  { valor: 3, inicial: "Q", nome: "Quarta" },
  { valor: 4, inicial: "Q", nome: "Quinta" },
  { valor: 5, inicial: "S", nome: "Sexta" },
  { valor: 6, inicial: "S", nome: "Sábado" },
] as const;

export const todosOsDias = diasDaSemana.map((d) => d.valor);

/** Rótulo curto dos dias agendados para exibir nas cards. */
export function labelDiasSemana(dias: number[]): string {
  const ordenados = [...dias].sort((a, b) => a - b);
  if (ordenados.length === 0) return "Nenhum dia";
  if (ordenados.length === 7) return "Todos os dias";
  if (ordenados.join(",") === "1,2,3,4,5") return "Seg a sex";
  return ordenados.map((v) => diasDaSemana[v]?.inicial ?? "?").join(" · ");
}

export interface ChecklistItem {
  id: string;
  titulo: string;
  detalhe?: string;
  status: ItemStatus;
  responsavel: string;
  /** Quantos anexos são obrigatórios para concluir a tarefa (0 = opcional). */
  minAnexos: number;
  /** Anexos enviados hoje (foto, vídeo ou documento); limpos no rollover diário. */
  anexos: Anexo[];
}

export interface Checklist {
  id: string;
  nome: string;
  setor: string;
  turno: string;
  horario: string;
  ativo: boolean;
  /** Índices de Date.getDay() (0 = domingo) em que a rotina deve rodar. */
  diasSemana: number[];
  /** "HH:MM" — horário limite para concluir; passou dele e não terminou = "atrasada". */
  tempoLimite?: string;
  itens: ChecklistItem[];
}

export interface ItemInput {
  /** Presente apenas ao editar um item já existente; identifica o item a preservar (status incluso). */
  id?: string;
  titulo: string;
  detalhe?: string;
  responsavel: string;
  /** Quantos anexos são obrigatórios para concluir a tarefa (0 = opcional). */
  minAnexos: number;
}

export interface ChecklistInput {
  nome: string;
  setor: string;
  turno: string;
  horario: string;
  ativo: boolean;
  diasSemana: number[];
  /** "HH:MM" ou undefined. */
  tempoLimite?: string;
  itens: ItemInput[];
}

/** Gera um id legível a partir do nome (usado como PK da checklist no Supabase). */
function slugify(texto: string) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const QUERY_KEY = ["checklists"] as const;

type ChecklistWithItems = ChecklistRow & { checklist_items: ChecklistItemRow[] };

/**
 * Busca checklists + itens em uma única query (join implícito do Postgrest via
 * "checklist_items(*)"). Ordena checklists por horário e, dentro de cada uma,
 * os itens pela coluna "posicao" (ordem definida na criação/edição).
 */
async function fetchChecklists(): Promise<Checklist[]> {
  const { data, error } = await supabase
    .from("checklists")
    .select("*, checklist_items(*)")
    .order("horario", { ascending: true })
    .order("posicao", { referencedTable: "checklist_items", ascending: true })
    .returns<ChecklistWithItems[]>();

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    nome: row.nome,
    setor: row.setor,
    turno: row.turno,
    horario: row.horario.slice(0, 5),
    ativo: row.ativo,
    diasSemana: [...(row.dias_semana ?? [])].sort((a, b) => a - b),
    ...(row.tempo_limite ? { tempoLimite: row.tempo_limite.slice(0, 5) } : {}),
    itens: row.checklist_items.map((it) => ({
      id: it.id,
      titulo: it.titulo,
      status: it.status as ItemStatus,
      responsavel: it.responsavel,
      minAnexos: it.min_anexos ?? 0,
      anexos: it.anexos ?? [],
      ...(it.detalhe ? { detalhe: it.detalhe } : {}),
    })),
  }));
}

interface Ctx {
  checklists: Checklist[];
  isLoading: boolean;
  isError: boolean;
  toggleItem: (checklistId: string, itemId: string) => void;
  concluirTodos: (checklistId: string) => void;
  reabrir: (checklistId: string) => void;
  /** Sobe um arquivo para o Storage e acrescenta o anexo ao item. */
  anexarArquivo: (checklistId: string, itemId: string, arquivo: File) => Promise<void>;
  /** Remove um anexo do item (pela URL). */
  removerAnexo: (checklistId: string, itemId: string, url: string) => Promise<void>;
  criarChecklist: (input: ChecklistInput) => void;
  editarChecklist: (checklistId: string, input: ChecklistInput) => void;
  excluirChecklist: (checklistId: string) => void;
}

const GCheckContext = React.createContext<Ctx | null>(null);

export function GCheckProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  // "enabled: !!session" evita chamar o Supabase (e estourar RLS) antes do login terminar.
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: fetchChecklists, enabled: !!session });

  // Rede de segurança do reset diário: além do pg_cron, o client chama
  // rollover_pendente() ao abrir e de tempos em tempos (cobre a aba deixada
  // aberta virando a meia-noite). A função é idempotente no servidor.
  React.useEffect(() => {
    if (!session) return;
    let vivo = true;
    const rodar = () => {
      rolloverPendente()
        .then(() => {
          if (!vivo) return;
          queryClient.invalidateQueries({ queryKey: QUERY_KEY });
          queryClient.invalidateQueries({ queryKey: HISTORICO_QUERY_KEY });
        })
        .catch(() => {
          /* silencioso: o pg_cron cobre o caminho normal */
        });
    };
    rodar();
    const id = window.setInterval(rodar, 15 * 60 * 1000);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [session, queryClient]);

  const toggleItemMutation = useMutation({
    mutationFn: async ({ itemId, next }: { itemId: string; next: ItemStatus }) => {
      const { error } = await supabase
        .from("checklist_items")
        .update({ status: next })
        .eq("id", itemId);
      if (error) throw error;
    },
    onError: () => {
      toast.error("Não foi possível atualizar o item.");
      // Reverte a atualização otimista buscando o estado real do servidor.
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const toggleItem = React.useCallback(
    (checklistId: string, itemId: string) => {
      // Trava de anexos: não deixa concluir sem os anexos mínimos (reforçada
      // também por trigger no banco — ver migration 20260901120000).
      const atual = (queryClient.getQueryData<Checklist[]>(QUERY_KEY) ?? [])
        .find((c) => c.id === checklistId)
        ?.itens.find((i) => i.id === itemId);
      if (atual && atual.status !== "concluido" && atual.anexos.length < atual.minAnexos) {
        const faltam = atual.minAnexos - atual.anexos.length;
        toast.error(
          `Anexe ${faltam === atual.minAnexos ? "" : "mais "}${faltam} ${
            faltam === 1 ? "arquivo" : "arquivos"
          } para concluir esta tarefa.`,
        );
        return;
      }

      let next: ItemStatus = "concluido";
      // Atualização otimista: aplica a mudança no cache do React Query antes da
      // resposta do servidor, para o toque no checkbox parecer instantâneo.
      // "next" é capturado pelo closure para ser reaproveitado na mutation abaixo.
      queryClient.setQueryData<Checklist[]>(QUERY_KEY, (prev) =>
        (prev ?? []).map((c) =>
          c.id !== checklistId
            ? c
            : {
                ...c,
                itens: c.itens.map((i) => {
                  if (i.id !== itemId) return i;
                  next = i.status === "concluido" ? "pendente" : "concluido";
                  return { ...i, status: next };
                }),
              },
        ),
      );
      toggleItemMutation.mutate({ itemId, next });
    },
    [queryClient, toggleItemMutation],
  );

  const concluirTodosMutation = useMutation({
    mutationFn: async (checklistId: string) => {
      const { error } = await supabase
        .from("checklist_items")
        .update({ status: "concluido" })
        .eq("checklist_id", checklistId);
      if (error) throw error;
    },
    onError: () => {
      toast.error("Não foi possível concluir a rotina.");
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const concluirTodos = React.useCallback(
    (checklistId: string) => {
      // "Concluir rotina" não fura a regra de anexos: se algum item pendente
      // ainda não tem os anexos mínimos, aborta e avisa quais faltam.
      const pendentesSemAnexo = (queryClient.getQueryData<Checklist[]>(QUERY_KEY) ?? [])
        .find((c) => c.id === checklistId)
        ?.itens.filter((i) => i.status !== "concluido" && i.anexos.length < i.minAnexos);
      if (pendentesSemAnexo && pendentesSemAnexo.length > 0) {
        toast.error(
          `Faltam anexos em: ${pendentesSemAnexo.map((i) => i.titulo).join(", ")}`,
        );
        return;
      }

      queryClient.setQueryData<Checklist[]>(QUERY_KEY, (prev) =>
        (prev ?? []).map((c) =>
          c.id !== checklistId
            ? c
            : { ...c, itens: c.itens.map((i) => ({ ...i, status: "concluido" as ItemStatus })) },
        ),
      );
      concluirTodosMutation.mutate(checklistId);
    },
    [queryClient, concluirTodosMutation],
  );

  const reabrirMutation = useMutation({
    mutationFn: async (checklistId: string) => {
      const { error } = await supabase
        .from("checklist_items")
        .update({ status: "pendente" })
        .eq("checklist_id", checklistId);
      if (error) throw error;
    },
    onError: () => {
      toast.error("Não foi possível reabrir a rotina.");
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const reabrir = React.useCallback(
    (checklistId: string) => {
      queryClient.setQueryData<Checklist[]>(QUERY_KEY, (prev) =>
        (prev ?? []).map((c) =>
          c.id !== checklistId
            ? c
            : { ...c, itens: c.itens.map((i) => ({ ...i, status: "pendente" as ItemStatus })) },
        ),
      );
      reabrirMutation.mutate(checklistId);
    },
    [queryClient, reabrirMutation],
  );

  const setAnexosNoCache = React.useCallback(
    (checklistId: string, itemId: string, anexos: Anexo[]) => {
      queryClient.setQueryData<Checklist[]>(QUERY_KEY, (prev) =>
        (prev ?? []).map((c) => {
          if (c.id !== checklistId) return c;
          return {
            ...c,
            itens: c.itens.map((i) => (i.id === itemId ? { ...i, anexos } : i)),
          };
        }),
      );
    },
    [queryClient],
  );

  /** Anexos atuais do item, lidos do cache do React Query. */
  const anexosDoItem = React.useCallback(
    (checklistId: string, itemId: string): Anexo[] =>
      (queryClient.getQueryData<Checklist[]>(QUERY_KEY) ?? [])
        .find((c) => c.id === checklistId)
        ?.itens.find((i) => i.id === itemId)?.anexos ?? [],
    [queryClient],
  );

  const anexarArquivoMutation = useMutation({
    mutationFn: async ({
      itemId,
      checklistId,
      arquivo,
    }: {
      checklistId: string;
      itemId: string;
      arquivo: File;
    }) => {
      const ext =
        arquivo.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
      const caminho = `${checklistId}/${itemId}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_ANEXOS)
        .upload(caminho, arquivo, {
          upsert: true,
          ...(arquivo.type ? { contentType: arquivo.type } : {}),
        });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from(BUCKET_ANEXOS).getPublicUrl(caminho);
      const novo: Anexo = {
        url: data.publicUrl,
        tipo: arquivo.type || "application/octet-stream",
        nome: arquivo.name,
      };

      // Acrescenta ao array atual e regrava a lista inteira.
      const proximos = [...anexosDoItem(checklistId, itemId), novo];
      const { error: updateError } = await supabase
        .from("checklist_items")
        .update({ anexos: proximos })
        .eq("id", itemId);
      if (updateError) throw updateError;

      return { checklistId, itemId, proximos };
    },
    onSuccess: ({ checklistId, itemId, proximos }) => {
      setAnexosNoCache(checklistId, itemId, proximos);
      toast.success("Arquivo anexado.");
    },
    onError: () => toast.error("Não foi possível anexar o arquivo."),
  });

  const removerAnexoMutation = useMutation({
    mutationFn: async ({
      itemId,
      checklistId,
      url,
    }: {
      checklistId: string;
      itemId: string;
      url: string;
    }) => {
      const proximos = anexosDoItem(checklistId, itemId).filter((a) => a.url !== url);
      const { error } = await supabase
        .from("checklist_items")
        .update({ anexos: proximos })
        .eq("id", itemId);
      if (error) throw error;
      return { checklistId, itemId, proximos };
    },
    onSuccess: ({ checklistId, itemId, proximos }) => {
      setAnexosNoCache(checklistId, itemId, proximos);
      toast.success("Anexo removido.");
    },
    onError: () => toast.error("Não foi possível remover o anexo."),
  });

  const anexarArquivo = React.useCallback(
    async (checklistId: string, itemId: string, arquivo: File) => {
      await anexarArquivoMutation.mutateAsync({ checklistId, itemId, arquivo });
    },
    [anexarArquivoMutation],
  );

  const removerAnexo = React.useCallback(
    async (checklistId: string, itemId: string, url: string) => {
      await removerAnexoMutation.mutateAsync({ checklistId, itemId, url });
    },
    [removerAnexoMutation],
  );

  const criarChecklistMutation = useMutation({
    mutationFn: async (input: ChecklistInput) => {
      // Id da checklist é o slug do nome; se já existir (mesmo nome usado antes),
      // acrescenta um sufixo numérico até achar um id livre.
      const existentes = (queryClient.getQueryData<Checklist[]>(QUERY_KEY) ?? []).map((c) => c.id);
      const baseId = slugify(input.nome) || "checklist";
      let id = baseId;
      let sufixo = 2;
      while (existentes.includes(id)) id = `${baseId}-${sufixo++}`;

      const { error: checklistError } = await supabase.from("checklists").insert({
        id,
        nome: input.nome,
        setor: input.setor,
        turno: input.turno,
        horario: input.horario,
        ativo: input.ativo,
        dias_semana: input.diasSemana,
        tempo_limite: input.tempoLimite ?? null,
      });
      if (checklistError) throw checklistError;

      // Ids dos itens seguem "<id-da-checklist>-<posição>" — todo item nasce "pendente".
      const itensPayload = input.itens.map((it, index) => ({
        id: `${id}-${index + 1}`,
        checklist_id: id,
        titulo: it.titulo,
        detalhe: it.detalhe?.trim() || null,
        responsavel: it.responsavel,
        status: "pendente",
        posicao: index + 1,
        min_anexos: it.minAnexos,
        anexos: [],
      }));

      const { error: itensError } = await supabase.from("checklist_items").insert(itensPayload);
      if (itensError) {
        // Não há transação entre as duas tabelas, então se os itens falharem
        // desfazemos manualmente a checklist já inserida para não deixar lixo órfão.
        await supabase.from("checklists").delete().eq("id", id);
        throw itensError;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: () => toast.error("Não foi possível criar a checklist."),
  });

  const criarChecklist = React.useCallback(
    (input: ChecklistInput) => {
      criarChecklistMutation.mutate(input);
    },
    [criarChecklistMutation],
  );

  const editarChecklistMutation = useMutation({
    mutationFn: async ({ checklistId, input }: { checklistId: string; input: ChecklistInput }) => {
      const atual = (queryClient.getQueryData<Checklist[]>(QUERY_KEY) ?? []).find(
        (c) => c.id === checklistId,
      );
      const statusPorId = new Map((atual?.itens ?? []).map((i) => [i.id, i.status]));
      // Preserva os anexos já enviados hoje quando o item sobrevive à edição.
      const anexosPorId = new Map(
        (atual?.itens ?? []).map((i) => [i.id, i.anexos ?? []] as const),
      );
      const idsUsados = new Set<string>();

      // Reconciliação de itens: o form manda "itemId" para itens que já existiam
      // (checklist-form-dialog.tsx) e nada para itens novos. Aqui reaproveitamos o
      // id original — e portanto o status ("concluido"/"pendente") — sempre que ele
      // ainda existe e não foi usado por outro item nesta mesma edição; caso
      // contrário (item novo, ou id duplicado/inválido) geramos um UUID novo, que
      // sempre nasce "pendente". Isso evita resetar o progresso já feito ao editar.
      const itensFinal = input.itens.map((it, index) => {
        let id = it.id && statusPorId.has(it.id) && !idsUsados.has(it.id) ? it.id : undefined;
        if (!id) id = crypto.randomUUID();
        idsUsados.add(id);

        return {
          id,
          checklist_id: checklistId,
          titulo: it.titulo,
          detalhe: it.detalhe?.trim() || null,
          responsavel: it.responsavel,
          status: statusPorId.get(id) ?? "pendente",
          posicao: index + 1,
          min_anexos: it.minAnexos,
          anexos: anexosPorId.get(id) ?? [],
        };
      });

      // Itens que existiam antes mas não estão mais na lista final são removidos.
      const idsFinal = new Set(itensFinal.map((i) => i.id));
      const idsRemover = (atual?.itens ?? []).map((i) => i.id).filter((id) => !idsFinal.has(id));

      const { error: checklistError } = await supabase
        .from("checklists")
        .update({
          nome: input.nome,
          setor: input.setor,
          turno: input.turno,
          horario: input.horario,
          ativo: input.ativo,
          dias_semana: input.diasSemana,
          tempo_limite: input.tempoLimite ?? null,
        })
        .eq("id", checklistId);
      if (checklistError) throw checklistError;

      if (idsRemover.length) {
        const { error: deleteError } = await supabase
          .from("checklist_items")
          .delete()
          .in("id", idsRemover);
        if (deleteError) throw deleteError;
      }

      const { error: upsertError } = await supabase.from("checklist_items").upsert(itensFinal);
      if (upsertError) throw upsertError;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: () => toast.error("Não foi possível salvar as alterações."),
  });

  const editarChecklist = React.useCallback(
    (checklistId: string, input: ChecklistInput) => {
      editarChecklistMutation.mutate({ checklistId, input });
    },
    [editarChecklistMutation],
  );

  const excluirChecklistMutation = useMutation({
    mutationFn: async (checklistId: string) => {
      // checklist_items tem "on delete cascade" no checklist_id, então apagar a
      // checklist remove os itens junto — não precisa deletar itens à mão.
      const { error } = await supabase.from("checklists").delete().eq("id", checklistId);
      if (error) throw error;
    },
    onSuccess: () => toast.success("Checklist excluída."),
    onError: () => {
      toast.error("Não foi possível excluir a checklist.");
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const excluirChecklist = React.useCallback(
    (checklistId: string) => {
      // Remoção otimista: tira a checklist do cache antes da resposta do servidor.
      queryClient.setQueryData<Checklist[]>(QUERY_KEY, (prev) =>
        (prev ?? []).filter((c) => c.id !== checklistId),
      );
      excluirChecklistMutation.mutate(checklistId);
    },
    [queryClient, excluirChecklistMutation],
  );

  const value = React.useMemo(
    () => ({
      checklists: query.data ?? [],
      isLoading: query.isLoading,
      isError: query.isError,
      toggleItem,
      concluirTodos,
      reabrir,
      anexarArquivo,
      removerAnexo,
      criarChecklist,
      editarChecklist,
      excluirChecklist,
    }),
    [
      query.data,
      query.isLoading,
      query.isError,
      toggleItem,
      concluirTodos,
      reabrir,
      anexarArquivo,
      removerAnexo,
      criarChecklist,
      editarChecklist,
      excluirChecklist,
    ],
  );

  return <GCheckContext.Provider value={value}>{children}</GCheckContext.Provider>;
}

export function useGCheck() {
  const ctx = React.useContext(GCheckContext);
  if (!ctx) throw new Error("useGCheck deve ser usado dentro de GCheckProvider");
  return ctx;
}

/** Contagem de itens concluídos/pendentes e percentual — usado no dashboard e nas cards. */
export function progresso(c: Checklist) {
  const total = c.itens.length;
  const feitos = c.itens.filter((i) => i.status === "concluido").length;
  return {
    total,
    feitos,
    pendentes: total - feitos,
    pct: total ? Math.round((feitos / total) * 100) : 0,
  };
}

/**
 * Agregado de tarefas (itens de checklist) por uma chave — nome do responsável
 * ou nome do setor. Alimenta as tabelas do dashboard ("tarefas por funcionário"
 * / "por setor") e os contadores nas páginas de funcionários e setores.
 */
export interface AgregadoTarefas {
  chave: string;
  total: number;
  feitos: number;
  /** Todos os itens não concluídos (inclui os atrasados). */
  pendentes: number;
  /** Subconjunto de "pendentes" cuja checklist já passou do tempo limite. */
  atrasados: number;
}

/** Percorre os itens das checklists ativas somando por chave. */
function agregaTarefas(
  checklists: Checklist[],
  chaveDoItem: (item: ChecklistItem, checklist: Checklist) => string,
): AgregadoTarefas[] {
  const mapa = new Map<string, AgregadoTarefas>();
  for (const c of checklists) {
    if (!c.ativo) continue;
    const cAtrasada = estado(c) === "atrasada";
    for (const i of c.itens) {
      const chave = chaveDoItem(i, c).trim();
      if (!chave) continue;
      const atual =
        mapa.get(chave) ?? { chave, total: 0, feitos: 0, pendentes: 0, atrasados: 0 };
      atual.total += 1;
      if (i.status === "concluido") {
        atual.feitos += 1;
      } else {
        atual.pendentes += 1;
        if (cAtrasada) atual.atrasados += 1;
      }
      mapa.set(chave, atual);
    }
  }
  // Mais atrasados primeiro, depois mais pendências; empata por volume e nome.
  return [...mapa.values()].sort(
    (a, b) =>
      b.atrasados - a.atrasados ||
      b.pendentes - a.pendentes ||
      b.total - a.total ||
      a.chave.localeCompare(b.chave),
  );
}

export function tarefasPorFuncionario(checklists: Checklist[]) {
  return agregaTarefas(checklists, (i) => i.responsavel);
}

export function tarefasPorSetor(checklists: Checklist[]) {
  return agregaTarefas(checklists, (_i, c) => c.setor);
}

/** Acha o agregado de uma chave (ignora caixa/espaços); devolve zerado se não houver. */
export function resumoDe(agregados: AgregadoTarefas[], chave: string): AgregadoTarefas {
  const alvo = chave.trim().toLowerCase();
  return (
    agregados.find((a) => a.chave.trim().toLowerCase() === alvo) ?? {
      chave,
      total: 0,
      feitos: 0,
      pendentes: 0,
      atrasados: 0,
    }
  );
}

/**
 * A rotina está programada para rodar nesta data? Fora dos dias marcados em
 * `diasSemana` a rotina conta como "desativada" naquele dia — não é cobrada no
 * dashboard, não pode ser marcada e nem abre na lista.
 */
export function rodaNoDia(c: Checklist, data: Date = new Date()): boolean {
  return c.diasSemana.includes(data.getDay());
}

export type ChecklistEstado = "concluido" | "em_andamento" | "pendente" | "atrasada";

/** Minutos desde a meia-noite de um "HH:MM" (ou de um Date). */
function minutosDoDia(v: string | Date): number {
  if (typeof v === "string") {
    const [h, m] = v.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  }
  return v.getHours() * 60 + v.getMinutes();
}

/**
 * Deriva o estado da checklist a partir do progresso — não é um campo salvo no
 * banco. "atrasada": tem tempo_limite, já passou dele e a rotina não terminou.
 * `agora` é injetável para testes; por padrão usa o relógio local.
 */
export function estado(c: Checklist, agora: Date = new Date()): ChecklistEstado {
  const { feitos, total } = progresso(c);
  if (total > 0 && feitos === total) return "concluido";
  if (c.tempoLimite && minutosDoDia(agora) > minutosDoDia(c.tempoLimite)) return "atrasada";
  if (feitos === 0) return "pendente";
  return "em_andamento";
}

export const estadoLabel: Record<ChecklistEstado, string> = {
  concluido: "Concluído",
  em_andamento: "Pendente",
  pendente: "Não iniciado",
  atrasada: "Atrasada",
};

/**
 * Rotina ainda "não iniciada": nada foi feito, está no prazo e o horário de
 * início ainda não chegou. Enquanto está nesse ponto, o painel não a cobra —
 * fica fora de pendências, taxa de execução e das quebras por funcionário/setor.
 * A partir do horário (mesmo sem nenhum item feito) ela passa a contar.
 */
export function naoIniciada(c: Checklist, agora: Date = new Date()): boolean {
  return estado(c, agora) === "pendente" && minutosDoDia(agora) < minutosDoDia(c.horario);
}

/** Compara o responsável do item com o nome de perfil informado (ignora caixa e espaços). */
export function ehResponsavel(item: ChecklistItem, nome?: string | null) {
  if (!nome) return false;
  return item.responsavel.trim().toLowerCase() === nome.trim().toLowerCase();
}
