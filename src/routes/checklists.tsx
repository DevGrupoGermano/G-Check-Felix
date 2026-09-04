import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarDays,
  CalendarOff,
  Check,
  ChevronDown,
  Clock,
  Eye,
  FileText,
  Filter,
  Loader2,
  Paperclip,
  Play,
  RotateCcw,
  Trash2,
  User,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EditarChecklistDialog, NovaChecklistDialog } from "@/components/checklist-form-dialog";
import { CalendarioChecklists } from "@/components/calendario-checklists";
import { SeletorDia } from "@/components/seletor-dia";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { cn, dataDoIso } from "@/lib/utils";
import { useAuth } from "@/lib/auth-store";
import type { ChecklistExecucaoRow } from "@/lib/supabase";
import { fetchExecucoes, HISTORICO_QUERY_KEY } from "@/lib/historico";
import {
  DIAS_DESATIVADOS_QUERY_KEY,
  reativarDia,
  useHojeDesativado,
} from "@/lib/dias-desativados";
import {
  checklistRodaNoDia,
  checklistVigenteNoDia,
  descricaoAgenda,
  ehResponsavel,
  itemRodaNoDia,
  labelRecorrencia,
  limiteDaRotina,
  progresso,
  turnos,
  turnoDoHorario,
  useGCheck,
  type Checklist,
  type ChecklistItem,
  type Turno,
} from "@/lib/g-check-store";

/**
 * Estado exibido na checklist — mais granular que o do painel:
 *  - `nao_iniciada` — a rotina ainda não chegou no horário programado (fora da
 *    janela) e ninguém começou;
 *  - `pendente` — já está no horário, mas nenhum item foi feito (amarelo);
 *  - `em_andamento` — algum item já foi concluído, mas não todos (azul);
 *  - `atrasada` — passou do tempo limite sem concluir (vermelho);
 *  - `concluido` — todos os itens feitos (verde).
 */
export type EstadoVista =
  | "nao_iniciada"
  | "pendente"
  | "em_andamento"
  | "atrasada"
  | "concluido";

const ESTADOS_VALIDOS: EstadoVista[] = [
  "nao_iniciada",
  "pendente",
  "em_andamento",
  "atrasada",
  "concluido",
];

/** Minutos desde a meia-noite de um horário "HH:MM". */
function minutosHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Estado ao vivo de uma rotina de hoje. A ordem das checagens define a
 * prioridade: concluída > atrasada > em andamento > pendente/não iniciada.
 */
function estadoVista(c: Checklist, agora: Date = new Date()): EstadoVista {
  const { feitos, total } = progresso(c);
  if (total > 0 && feitos === total) return "concluido";
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();
  const limite = limiteDaRotina(c);
  if (limite && agoraMin > minutosHHMM(limite)) return "atrasada";
  if (feitos > 0) return "em_andamento";
  // Nada feito e dentro do prazo: "pendente" quando o horário de início dos
  // itens já chegou (ou não há horário); senão ainda está fora da janela.
  return !c.horarioInicio || agoraMin >= minutosHHMM(c.horarioInicio)
    ? "pendente"
    : "nao_iniciada";
}

/**
 * Estado do card conforme o dia em foco. Só o dia de hoje tem relógio ao vivo;
 * nos dias só-leitura (passado/futuro) "nada feito" é sempre "não iniciada".
 */
function estadoVistaCard(c: Checklist, ehHoje: boolean): EstadoVista {
  if (ehHoje) return estadoVista(c);
  const { feitos, total } = progresso(c);
  if (total > 0 && feitos === total) return "concluido";
  return feitos > 0 ? "em_andamento" : "nao_iniciada";
}

/** Rótulo + classes do badge de cada estado da checklist. */
const ESTADO_VISTA_UI: Record<EstadoVista, { label: string; classe: string }> = {
  nao_iniciada: { label: "Não iniciada", classe: "bg-muted text-muted-foreground" },
  pendente: { label: "Pendente", classe: "bg-chart-4/20 text-chart-4" },
  em_andamento: { label: "Em andamento", classe: "bg-info/15 text-info" },
  atrasada: { label: "Atrasada", classe: "bg-destructive/15 text-destructive" },
  concluido: { label: "Concluído", classe: "bg-success/15 text-success" },
};

/**
 * Monta um `Checklist` somente-leitura a partir do snapshot de um dia já fechado
 * (`checklist_execucoes`). Sem `tempoLimite` de propósito: fora de hoje não faz
 * sentido derivar "atrasada" pelo relógio atual. O snapshot já traz só os itens
 * que rodaram naquele dia, então cada item ganha uma recorrência "semanal" só
 * naquele dia da semana — assim os filtros por dia continuam mostrando todos.
 */
function checklistDeSnapshot(e: ChecklistExecucaoRow, vivo: Checklist | undefined): Checklist {
  const dowSnapshot = dataDoIso(e.data).getDay();
  const itens: ChecklistItem[] = (e.itens ?? []).map((it, idx) => {
    const horarioInicio = it.horario_inicio ? it.horario_inicio.slice(0, 5) : null;
    return {
      id: `${e.checklist_id}-snap-${idx}`,
      titulo: it.titulo,
      responsavel: it.responsavel,
      status: it.status === "concluido" ? "concluido" : "pendente",
      tipoTarefa: it.tipo_tarefa ?? "checklist",
      respostaOpcoes: it.resposta_opcoes ?? [],
      resposta: it.resposta ?? null,
      justificativa: it.justificativa ?? null,
      turno: it.turno ?? turnoDoHorario(horarioInicio),
      horarioInicio,
      horarioTermino: it.horario_termino ? it.horario_termino.slice(0, 5) : null,
      minAnexos: it.min_anexos ?? 0,
      maxAnexos: it.max_anexos ?? null,
      anexos: it.anexos ?? [],
      recorrencia: "semanal" as const,
      diasSemana: [dowSnapshot],
      inicio: null,
    };
  });
  return {
    id: e.checklist_id,
    nome: e.nome,
    setor: e.setor,
    ativo: vivo?.ativo ?? true,
    reabreAutomatico: vivo?.reabreAutomatico ?? false,
    ...(vivo?.reabreIntervaloMin ? { reabreIntervaloMin: vivo.reabreIntervaloMin } : {}),
    ...descricaoAgenda(itens),
    criadoEm: vivo?.criadoEm ?? e.data,
    itens,
  };
}

/** Cópia da rotina com todo item "pendente" — usada em dias que ainda não chegaram. */
function checklistPendente(c: Checklist): Checklist {
  return {
    ...c,
    // Dia que ainda não chegou: sem status e sem os anexos do dia de hoje.
    itens: c.itens.map((i) => ({
      ...i,
      anexos: [],
      status: "pendente" as const,
      resposta: null,
      justificativa: null,
    })),
  };
}

/**
 * Filtros (e o card a destacar) vêm pela URL — assim o dashboard pode linkar
 * direto para "/checklists" já com um recorte aplicado, e o estado do filtro
 * fica compartilhável/versionável pelo histórico do navegador.
 */
export interface ChecklistSearch {
  estados?: EstadoVista[] | undefined;
  turnos?: Turno[] | undefined;
  /**
   * Faixa de horário de início ("HH:MM"): mantém rotinas com ao menos um item
   * começando dentro do intervalo. Qualquer um dos limites pode vir sozinho.
   */
  horarioDe?: string | undefined;
  horarioAte?: string | undefined;
  /** Nomes de setores para recortar as rotinas (casa com `checklist.setor`). */
  setores?: string[] | undefined;
  /** Nomes de responsáveis: mantém as rotinas que têm ao menos um item da pessoa. */
  funcionarios?: string[] | undefined;
  /** id da checklist que deve abrir expandida e receber scroll ao entrar na página. */
  checklist?: string | undefined;
  /**
   * Seletor de dia: ISO "yyyy-MM-dd" filtra pelas atividades daquele dia;
   * "todas" mostra todas as atividades de todas as rotinas (somente leitura);
   * "quinzenal"/"mensal" mostram só as atividades daquela recorrência, de todas
   * as rotinas, sem recorte por dia (somente leitura).
   */
  dia?: string | undefined;
  /** "calendario" troca o conteúdo do <main> pela tela de calendário (header/sidebar seguem). */
  vista?: "calendario" | undefined;
}

export const Route = createFileRoute("/checklists")({
  head: () => ({
    meta: [
      { title: "Checklists de rotina — G-check" },
      {
        name: "description",
        content:
          "Abra e conclua rotinas de supermercado: abertura, reposição de gôndolas, validade, limpeza e fechamento.",
      },
      { property: "og:title", content: "Checklists de rotina — G-check" },
      {
        property: "og:description",
        content: "Acompanhe item por item as rotinas operacionais da sua loja.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): ChecklistSearch => {
    const rawEstados = search["estados"];
    const rawTurnos = search["turnos"];
    const rawHorarioDe = search["horarioDe"];
    const rawHorarioAte = search["horarioAte"];
    const rawSetores = search["setores"];
    const rawFuncionarios = search["funcionarios"];
    const rawChecklist = search["checklist"];
    const rawDia = search["dia"];
    const rawVista = search["vista"];

    const estados = Array.isArray(rawEstados)
      ? rawEstados.filter((e): e is EstadoVista => ESTADOS_VALIDOS.includes(e as EstadoVista))
      : undefined;
    const turnosSearch = Array.isArray(rawTurnos)
      ? rawTurnos.filter((t): t is Turno => (turnos as readonly string[]).includes(t as string))
      : undefined;
    const ehHHMM = (v: unknown): v is string =>
      typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
    const horarioDe = ehHHMM(rawHorarioDe) ? rawHorarioDe : undefined;
    const horarioAte = ehHHMM(rawHorarioAte) ? rawHorarioAte : undefined;
    // Setores/funcionários são texto livre (vêm do cadastro): só filtramos por tipo.
    const setores = Array.isArray(rawSetores)
      ? rawSetores.filter((s): s is string => typeof s === "string" && s.length > 0)
      : undefined;
    const funcionarios = Array.isArray(rawFuncionarios)
      ? rawFuncionarios.filter((f): f is string => typeof f === "string" && f.length > 0)
      : undefined;
    const checklist = typeof rawChecklist === "string" ? rawChecklist : undefined;
    const dia =
      rawDia === "todas" || rawDia === "quinzenal" || rawDia === "mensal"
        ? rawDia
        : typeof rawDia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDia)
          ? rawDia
          : undefined;
    const vista = rawVista === "calendario" ? "calendario" : undefined;

    return {
      ...(estados && estados.length ? { estados } : {}),
      ...(turnosSearch && turnosSearch.length ? { turnos: turnosSearch } : {}),
      ...(horarioDe ? { horarioDe } : {}),
      ...(horarioAte ? { horarioAte } : {}),
      ...(setores && setores.length ? { setores } : {}),
      ...(funcionarios && funcionarios.length ? { funcionarios } : {}),
      ...(checklist ? { checklist } : {}),
      ...(dia ? { dia } : {}),
      ...(vista ? { vista } : {}),
    };
  },
  component: ChecklistsPage,
});

const estadoOptions: { id: EstadoVista; label: string }[] = [
  { id: "nao_iniciada", label: "Não iniciadas" },
  { id: "pendente", label: "Pendentes" },
  { id: "em_andamento", label: "Em andamento" },
  { id: "atrasada", label: "Atrasadas" },
  { id: "concluido", label: "Concluídos" },
];

const turnoOptions: { id: Turno; label: string }[] = turnos.map((t) => ({ id: t, label: t }));

/**
 * Botão de filtros: abre um popover com as opções agrupadas (Estado / Turno /
 * Setor / Funcionário) onde cada clique já liga/desliga aquele filtro
 * (multi-seleção, sem passo extra de "aplicar"). Setor e Funcionário saem dos
 * próprios dados das rotinas, então a busca no topo ajuda quando a lista cresce.
 * As opções ativas aparecem como badges removíveis ao lado, cada uma com seu X.
 */
function FiltrosChecklist({
  estadosSelecionados,
  turnosSelecionados,
  horarioDe,
  horarioAte,
  setoresSelecionados,
  funcionariosSelecionados,
  horariosDisponiveis,
  setoresDisponiveis,
  funcionariosDisponiveis,
  onToggleEstado,
  onToggleTurno,
  onChangeHorario,
  onToggleSetor,
  onToggleFuncionario,
  onLimpar,
}: {
  estadosSelecionados: EstadoVista[];
  turnosSelecionados: Turno[];
  horarioDe: string | undefined;
  horarioAte: string | undefined;
  setoresSelecionados: string[];
  funcionariosSelecionados: string[];
  /** Horários de início presentes nos itens — viram sugestões nos campos De/Até. */
  horariosDisponiveis: string[];
  setoresDisponiveis: string[];
  funcionariosDisponiveis: string[];
  onToggleEstado: (id: EstadoVista) => void;
  onToggleTurno: (id: Turno) => void;
  onChangeHorario: (patch: { de?: string | undefined; ate?: string | undefined }) => void;
  onToggleSetor: (id: string) => void;
  onToggleFuncionario: (id: string) => void;
  onLimpar: () => void;
}) {
  const temHorario = !!horarioDe || !!horarioAte;
  const total =
    estadosSelecionados.length +
    turnosSelecionados.length +
    (temHorario ? 1 : 0) +
    setoresSelecionados.length +
    funcionariosSelecionados.length;

  // Os campos "De"/"Até" são digitados localmente e só entram na URL quando o
  // campo perde o foco (ou no Enter). Se cada tecla chamasse onChangeHorario, o
  // navigate() re-renderiza e devolve o valor controlado no meio da digitação —
  // por isso "11:30" virava "11:03"/"11:00".
  const [horDe, setHorDe] = React.useState(horarioDe ?? "");
  const [horAte, setHorAte] = React.useState(horarioAte ?? "");
  React.useEffect(() => setHorDe(horarioDe ?? ""), [horarioDe]);
  React.useEffect(() => setHorAte(horarioAte ?? ""), [horarioAte]);
  const comitarDe = () => {
    if ((horDe || undefined) !== horarioDe) onChangeHorario({ de: horDe || undefined });
  };
  const comitarAte = () => {
    if ((horAte || undefined) !== horarioAte) onChangeHorario({ ate: horAte || undefined });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="size-4" />
            Filtros
            {total > 0 && (
              <Badge className="h-5 min-w-5 justify-center rounded-full border-transparent bg-primary px-1 text-primary-foreground">
                {total}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <Command>
            <CommandInput placeholder="Buscar filtro…" />
            <CommandList>
              <CommandEmpty>Nada encontrado.</CommandEmpty>
              <CommandGroup heading="Estado">
                {estadoOptions.map((o) => {
                  const ativo = estadosSelecionados.includes(o.id);
                  return (
                    <CommandItem
                      key={o.id}
                      onSelect={() => onToggleEstado(o.id)}
                      className="justify-between"
                    >
                      {o.label}
                      {ativo && <Check className="size-4 text-primary" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Turno">
                {turnoOptions.map((o) => {
                  const ativo = turnosSelecionados.includes(o.id);
                  return (
                    <CommandItem
                      key={o.id}
                      onSelect={() => onToggleTurno(o.id)}
                      className="justify-between"
                    >
                      {o.label}
                      {ativo && <Check className="size-4 text-primary" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {setoresDisponiveis.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Setor">
                    {setoresDisponiveis.map((s) => {
                      const ativo = setoresSelecionados.includes(s);
                      return (
                        <CommandItem
                          key={s}
                          value={`setor ${s}`}
                          onSelect={() => onToggleSetor(s)}
                          className="justify-between"
                        >
                          <span className="truncate">{s}</span>
                          {ativo && <Check className="size-4 shrink-0 text-primary" />}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}
              {funcionariosDisponiveis.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Funcionário">
                    {funcionariosDisponiveis.map((f) => {
                      const ativo = funcionariosSelecionados.includes(f);
                      return (
                        <CommandItem
                          key={f}
                          value={`funcionario ${f}`}
                          onSelect={() => onToggleFuncionario(f)}
                          className="justify-between"
                        >
                          <span className="truncate">{f}</span>
                          {ativo && <Check className="size-4 shrink-0 text-primary" />}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>

          <div className="border-t border-border p-3">
            <p className="text-xs font-medium text-muted-foreground">Horário de início</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="time"
                aria-label="Horário inicial"
                value={horDe}
                list="checklist-horarios"
                onChange={(e) => setHorDe(e.target.value)}
                onBlur={comitarDe}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <span className="text-xs text-muted-foreground">até</span>
              <input
                type="time"
                aria-label="Horário final"
                value={horAte}
                list="checklist-horarios"
                onChange={(e) => setHorAte(e.target.value)}
                onBlur={comitarAte}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            {horariosDisponiveis.length > 0 && (
              <datalist id="checklist-horarios">
                {horariosDisponiveis.map((h) => (
                  <option key={h} value={h} />
                ))}
              </datalist>
            )}
            {temHorario && (
              <button
                onClick={() => onChangeHorario({ de: undefined, ate: undefined })}
                className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Limpar horário
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {estadosSelecionados.map((id) => (
        <Badge key={id} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1.5 font-medium">
          {estadoOptions.find((o) => o.id === id)?.label}
          <button
            onClick={() => onToggleEstado(id)}
            aria-label={`Remover filtro ${estadoOptions.find((o) => o.id === id)?.label ?? id}`}
            className="rounded-full p-0.5 hover:bg-foreground/10"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      {turnosSelecionados.map((t) => (
        <Badge key={t} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1.5 font-medium">
          {t}
          <button
            onClick={() => onToggleTurno(t)}
            aria-label={`Remover filtro ${t}`}
            className="rounded-full p-0.5 hover:bg-foreground/10"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      {temHorario && (
        <Badge variant="secondary" className="gap-1 py-1 pl-2.5 pr-1.5 font-medium">
          {horarioDe && horarioAte
            ? `${horarioDe}–${horarioAte}`
            : horarioDe
              ? `a partir de ${horarioDe}`
              : `até ${horarioAte}`}
          <button
            onClick={() => onChangeHorario({ de: undefined, ate: undefined })}
            aria-label="Remover filtro de horário"
            className="rounded-full p-0.5 hover:bg-foreground/10"
          >
            <X className="size-3" />
          </button>
        </Badge>
      )}
      {setoresSelecionados.map((s) => (
        <Badge key={s} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1.5 font-medium">
          {s}
          <button
            onClick={() => onToggleSetor(s)}
            aria-label={`Remover filtro ${s}`}
            className="rounded-full p-0.5 hover:bg-foreground/10"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      {funcionariosSelecionados.map((f) => (
        <Badge key={f} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1.5 font-medium">
          {f}
          <button
            onClick={() => onToggleFuncionario(f)}
            aria-label={`Remover filtro ${f}`}
            className="rounded-full p-0.5 hover:bg-foreground/10"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      {total > 0 && (
        <button
          onClick={onLimpar}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Limpar tudo
        </button>
      )}
    </div>
  );
}

function EstadoBadge({ c, ehHoje = true }: { c: Checklist; ehHoje?: boolean }) {
  const ui = ESTADO_VISTA_UI[estadoVistaCard(c, ehHoje)];
  return (
    <Badge variant="outline" className={cn("border-transparent font-medium", ui.classe)}>
      {ui.label}
    </Badge>
  );
}

/**
 * Badge de uma rotina de um dia já fechado: não há "em andamento" — ou ela foi
 * concluída (verde) ou ficou incompleta (vermelho), com o mesmo ponto colorido
 * usado no Histórico.
 */
function BadgeDiaFechado({ c }: { c: Checklist }) {
  const { feitos, total } = progresso(c);
  const completa = total > 0 && feitos === total;
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 border-transparent font-medium",
        completa ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
      )}
    >
      <span className={cn("size-1.5 rounded-full", completa ? "bg-success" : "bg-destructive")} />
      {completa ? "Concluída" : "Incompleta"}
    </Badge>
  );
}

function ExcluirChecklistButton({ c }: { c: Checklist }) {
  const { excluirChecklist } = useGCheck();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Excluir ${c.nome}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir “{c.nome}”?</AlertDialogTitle>
          <AlertDialogDescription>
            A checklist e seus {c.itens.length} {c.itens.length === 1 ? "item" : "itens"} serão
            removidos. Não dá para desfazer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => excluirChecklist(c.id)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Tipos aceitos no seletor de arquivo dos anexos de comprovação. */
const ACCEPT_ANEXOS = "image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt";

/**
 * Botões de opção de uma atividade "enquete". Ficam do lado oposto ao check
 * (que abre à esquerda da linha). Só o responsável (ou admin) escolhe; a
 * conclusão exige uma opção marcada (trava no store e no trigger do banco).
 */
function EnqueteOpcoes({
  checklistId,
  item,
  podeEditar,
  className,
}: {
  checklistId: string;
  item: ChecklistItem;
  podeEditar: boolean;
  className?: string;
}) {
  const { responderEnquete } = useGCheck();
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {item.respostaOpcoes.map((opcao) => {
        const ativo = item.resposta === opcao;
        return (
          <button
            key={opcao}
            type="button"
            disabled={!podeEditar}
            aria-pressed={ativo}
            onClick={() => podeEditar && responderEnquete(checklistId, item.id, opcao)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              ativo
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input text-muted-foreground hover:border-primary hover:text-foreground",
              !podeEditar && "cursor-not-allowed opacity-60",
            )}
          >
            {opcao}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Barra de justificativa/observação de uma atividade "enquete": o responsável
 * explica o motivo da resposta — vale tanto para as positivas quanto para as
 * negativas. Grava no `onBlur` (sem botão extra).
 */
function JustificativaCampo({
  checklistId,
  item,
  podeEditar,
  className,
}: {
  checklistId: string;
  item: ChecklistItem;
  podeEditar: boolean;
  className?: string;
}) {
  const { justificarItem } = useGCheck();
  const [texto, setTexto] = React.useState(item.justificativa ?? "");
  React.useEffect(() => {
    setTexto(item.justificativa ?? "");
  }, [item.justificativa]);

  return (
    <Textarea
      rows={2}
      value={texto}
      disabled={!podeEditar}
      placeholder="Justificativa / observação (o motivo da resposta)"
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        if (texto !== (item.justificativa ?? "")) justificarItem(checklistId, item.id, texto);
      }}
      className={cn("text-sm", className)}
    />
  );
}

/**
 * Anexos de comprovação de um item (foto, vídeo ou documento — vários por item).
 * Quando `podeEditar`, mostra o botão de adicionar e o "x" de cada anexo; caso
 * contrário fica só com as miniaturas/chips clicáveis (dia fechado / leitura).
 * A trava de "não conclui sem os anexos mínimos" mora no store (toggleItem) e no
 * banco (trigger).
 */
function AnexosItem({
  checklistId,
  item,
  podeEditar,
}: {
  checklistId: string;
  item: ChecklistItem;
  podeEditar: boolean;
}) {
  const { anexarArquivo, removerAnexo } = useGCheck();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = React.useState(false);

  async function aoEscolher(ev: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(ev.target.files ?? []);
    ev.target.value = "";
    if (arquivos.length === 0) return;
    setEnviando(true);
    try {
      for (const arquivo of arquivos) {
        await anexarArquivo(checklistId, item.id, arquivo);
      }
    } catch {
      /* erro já sinalizado por toast no store */
    } finally {
      setEnviando(false);
    }
  }

  async function aoRemover(url: string) {
    setEnviando(true);
    try {
      await removerAnexo(checklistId, item.id, url);
    } catch {
      /* toast no store */
    } finally {
      setEnviando(false);
    }
  }

  const faltam = Math.max(0, item.minAnexos - item.anexos.length);

  return (
    <div className="mt-2 flex flex-col gap-2">
      {(item.anexos.length > 0 || item.minAnexos > 0 || podeEditar) && (
        <div className="flex flex-wrap items-center gap-2">
          {item.anexos.map((a) => {
            const ehImagem = a.tipo.startsWith("image/");
            const ehVideo = a.tipo.startsWith("video/");
            return (
              <span key={a.url} className="group relative inline-flex shrink-0">
                {ehImagem ? (
                  <a href={a.url} target="_blank" rel="noreferrer">
                    <img
                      src={a.url}
                      alt={a.nome}
                      className="size-14 rounded-lg border border-border object-cover"
                    />
                  </a>
                ) : (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-[10rem] items-center gap-1.5 rounded-lg border border-border bg-muted px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {ehVideo ? (
                      <Play className="size-3.5 shrink-0" />
                    ) : (
                      <FileText className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate">{a.nome}</span>
                  </a>
                )}
                {podeEditar && (
                  <button
                    type="button"
                    onClick={() => aoRemover(a.url)}
                    disabled={enviando}
                    aria-label={`Remover ${a.nome}`}
                    className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-background p-0.5 text-muted-foreground shadow-sm hover:text-destructive disabled:opacity-50"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            );
          })}

          {podeEditar && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT_ANEXOS}
                multiple
                hidden
                onChange={aoEscolher}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2 text-xs"
                disabled={enviando}
                onClick={() => inputRef.current?.click()}
              >
                {enviando ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Paperclip className="size-3.5" />
                )}
                Adicionar arquivo
              </Button>
            </>
          )}

          {!podeEditar && item.anexos.length === 0 && (
            <span className="text-xs text-muted-foreground">Sem anexos</span>
          )}
        </div>
      )}

      {item.minAnexos > 0 && (
        <span
          className={cn(
            "text-xs",
            faltam > 0 ? "font-medium text-chart-4" : "text-muted-foreground",
          )}
        >
          {item.anexos.length}/{item.minAnexos} anexos
          {faltam > 0 && ` · faltam ${faltam}`}
        </span>
      )}
    </div>
  );
}

function ChecklistCard({
  c,
  destacar = false,
  travado = false,
  somenteLeitura = false,
  diaFechado = false,
}: {
  c: Checklist;
  destacar?: boolean | undefined;
  /** Dia pausado (feriado): itens não podem ser marcados/concluídos/reabertos. */
  travado?: boolean | undefined;
  /** Dia diferente de hoje: a card abre para ver as tarefas, mas nada pode ser marcado. */
  somenteLeitura?: boolean | undefined;
  /** Dia passado já encerrado: o badge de estado vira "Concluída"/"Incompleta". */
  diaFechado?: boolean | undefined;
}) {
  const { toggleItem, concluirTodos, reabrir } = useGCheck();
  const { isAdmin, profile } = useAuth();
  const [aberto, setAberto] = React.useState(destacar);
  const sectionRef = React.useRef<HTMLElement>(null);
  const p = progresso(c);
  // Dia pausado (feriado): a rotina não abre nem aceita marcação — o card fica só
  // com o cabeçalho. "somenteLeitura" (outro dia) ainda abre.
  const bloqueado = travado;
  const expandido = aberto && !bloqueado;

  // Chegou pela URL "?checklist=<id>" (link de uma pendência no dashboard):
  // rola até a card e a deixa expandida.
  React.useEffect(() => {
    if (destacar) sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [destacar]);

  return (
    <section
      ref={sectionRef}
      className={cn(
        "scroll-mt-24 rounded-2xl border border-border bg-card shadow-sm transition-shadow",
        (!c.ativo || bloqueado) && "opacity-70",
        destacar && "ring-2 ring-primary/60",
      )}
    >
      <div className="flex items-start gap-2 p-5">
        <button
          onClick={() => setAberto((v) => !v)}
          disabled={bloqueado}
          className="flex min-w-0 flex-1 flex-col gap-4 text-left disabled:cursor-not-allowed"
          aria-expanded={expandido}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">{c.nome}</h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{c.setor}</span>
                {(c.turnos.length > 0 || c.horarioInicio) && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" />{" "}
                    {[
                      c.turnos.join(" · "),
                      c.horarioInicio &&
                        (c.horarioTermino
                          ? `${c.horarioInicio}–${c.horarioTermino}`
                          : c.horarioInicio),
                      c.tempoLimite && `até ${c.tempoLimite}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="size-3.5" />{" "}
                  {c.itens.length} {c.itens.length === 1 ? "atividade" : "atividades"}
                </span>
                {c.reabreAutomatico && c.reabreIntervaloMin && (
                  <span className="inline-flex items-center gap-1">
                    <RotateCcw className="size-3.5" /> reabre a cada {c.reabreIntervaloMin} min
                  </span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!c.ativo && (
                <Badge
                  variant="outline"
                  className="border-transparent bg-muted text-muted-foreground"
                >
                  Inativa
                </Badge>
              )}
              {somenteLeitura && !bloqueado && (
                <Badge
                  variant="outline"
                  className="gap-1 border-transparent bg-muted text-muted-foreground"
                >
                  <Eye className="size-3" />
                  Leitura
                </Badge>
              )}
              {bloqueado ? (
                <Badge
                  variant="outline"
                  className="border-transparent bg-muted text-muted-foreground"
                >
                  Desativada hoje
                </Badge>
              ) : diaFechado ? (
                <BadgeDiaFechado c={c} />
              ) : (
                <EstadoBadge c={c} ehHoje={!somenteLeitura} />
              )}
              {!bloqueado && (
                <ChevronDown
                  className={cn(
                    "size-4 text-muted-foreground transition-transform",
                    expandido && "rotate-180",
                  )}
                />
              )}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {p.feitos} de {p.total} itens concluídos
              </span>
              <span className="font-medium text-foreground">{p.pct}%</span>
            </div>
            <Progress value={p.pct} className="h-1.5" />
          </div>
        </button>
        {isAdmin && (
          <div className="flex shrink-0 items-center gap-0.5">
            <EditarChecklistDialog checklist={c} />
            <ExcluirChecklistButton c={c} />
          </div>
        )}
      </div>

      {expandido && (
        <div className="border-t border-border p-5 pt-4">
          <ul className="divide-y divide-border">
            {c.itens.map((i) => {
              const feito = i.status === "concluido";
              // Admin marca qualquer item; funcionário só o que está atribuído a
              // ele (comparação por nome, ver ehResponsavel em g-check-store.tsx).
              // Reforçado no banco pela migration
              // 20260824140000_restrict_item_status_to_responsavel.sql.
              const podeMarcar =
                !bloqueado && !somenteLeitura && (isAdmin || ehResponsavel(i, profile?.nome));
              // Item que ainda não tem os anexos mínimos: não dá pra concluir (só reabrir).
              const anexosPendentes = i.anexos.length < i.minAnexos && !feito;
              // Enquete sem opção escolhida: idem, trava a conclusão.
              const respostaPendente = i.tipoTarefa === "enquete" && !i.resposta && !feito;
              const travaConclusao = anexosPendentes || respostaPendente;
              // Horário/turno definidos para a atividade (turno cai do horário
              // quando não foi escolhido à mão).
              const turnoItem = i.turno ?? turnoDoHorario(i.horarioInicio);
              const faixaHoraria = i.horarioInicio
                ? i.horarioTermino
                  ? `${i.horarioInicio}–${i.horarioTermino}`
                  : `a partir de ${i.horarioInicio}`
                : null;
              const infoHorario = [turnoItem, faixaHoraria].filter(Boolean).join(" · ");
              return (
                <li key={i.id} className="flex flex-wrap items-start gap-3 py-3">
                  <button
                    onClick={() => podeMarcar && !travaConclusao && toggleItem(c.id, i.id)}
                    disabled={!podeMarcar || travaConclusao}
                    aria-label={
                      bloqueado
                        ? "Rotina desativada hoje"
                        : somenteLeitura
                          ? "Somente leitura — abra o dia de hoje para marcar"
                          : !podeMarcar
                            ? `Item atribuído a ${i.responsavel}`
                            : anexosPendentes
                              ? `Anexe os arquivos para concluir ${i.titulo}`
                              : respostaPendente
                                ? `Escolha uma resposta para concluir ${i.titulo}`
                                : feito
                                  ? `Reabrir ${i.titulo}`
                                  : `Concluir ${i.titulo}`
                    }
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                      feito
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input hover:border-primary",
                      (!podeMarcar || travaConclusao) &&
                        "cursor-not-allowed opacity-50 hover:border-input",
                    )}
                  >
                    {feito && <Check className="size-3.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        feito && "text-muted-foreground line-through",
                      )}
                    >
                      {i.titulo}
                    </p>
                    {i.detalhe && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{i.detalhe}</p>
                    )}
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <User className="size-3" /> {i.responsavel}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="size-3" /> {labelRecorrencia(i)}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1",
                          !infoHorario && "italic",
                        )}
                      >
                        <Clock className="size-3" />{" "}
                        {infoHorario || "Sem horário definido"}
                      </span>
                      {i.tipoTarefa === "enquete" && (
                        <span className="inline-flex items-center gap-1">
                          <FileText className="size-3" /> Enquete
                        </span>
                      )}
                      {i.minAnexos > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="size-3" /> {i.minAnexos}{" "}
                          {i.minAnexos === 1 ? "anexo obrigatório" : "anexos obrigatórios"}
                        </span>
                      )}
                    </p>
                    {(i.minAnexos > 0 || i.anexos.length > 0) && (
                      <AnexosItem
                        checklistId={c.id}
                        item={i}
                        podeEditar={podeMarcar && !feito}
                      />
                    )}
                  </div>
                  {i.tipoTarefa === "enquete" && (
                    <>
                      <EnqueteOpcoes
                        checklistId={c.id}
                        item={i}
                        podeEditar={podeMarcar && !feito}
                        className="shrink-0 justify-end sm:max-w-[45%]"
                      />
                      <JustificativaCampo
                        checklistId={c.id}
                        item={i}
                        podeEditar={podeMarcar && !feito}
                        className="mt-1 basis-full"
                      />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {isAdmin && !somenteLeitura && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => concluirTodos(c.id)}
                disabled={bloqueado || p.pendentes === 0}
              >
                <Check className="size-4" /> Concluir rotina
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => reabrir(c.id)}
                disabled={bloqueado || p.feitos === 0}
              >
                <RotateCcw className="size-4" /> Reabrir
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Faixa exibida quando as rotinas de hoje estão desativadas (feriado). Para o
 * funcionário é só informativa; para o admin traz o atalho de reativar (a ação
 * "oficial" de pausar/retomar fica no dashboard, em PausaRotinasHoje).
 */
function BannerRotinasPausadas({ hojeISO }: { hojeISO: string }) {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [enviando, setEnviando] = React.useState(false);

  async function reativar() {
    setEnviando(true);
    try {
      await reativarDia(hojeISO);
      toast.success("Rotinas de hoje reativadas.");
      queryClient.invalidateQueries({ queryKey: DIAS_DESATIVADOS_QUERY_KEY });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível reativar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-chart-4/30 bg-chart-4/10 p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-chart-4/20 text-chart-4">
          <CalendarOff className="size-4.5" />
        </span>
        <div>
          <p className="text-sm font-semibold">Rotinas de hoje desativadas</p>
          <p className="text-xs text-muted-foreground">
            A marcação de itens está travada hoje.{" "}
            {isAdmin ? "Reative para voltar a registrar." : "Fale com o administrador."}
          </p>
        </div>
      </div>
      {isAdmin && (
        <Button size="sm" variant="outline" disabled={enviando} onClick={reativar}>
          {enviando ? "Reativando…" : "Reativar rotinas de hoje"}
        </Button>
      )}
    </section>
  );
}

const fmtDataTarefa = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const fmtDiaLongo = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
});

/**
 * Uma tarefa (item) do funcionário: o item em si, a rotina a que pertence e o
 * estado derivado só daquela tarefa — concluída, atrasada (rotina passou do
 * tempo limite sem terminar), pendente (no horário) ou não iniciada (rotina
 * ainda fora da janela). Um item nunca fica "em andamento".
 */
interface TarefaFuncionario {
  checklist: Checklist;
  item: ChecklistItem;
  estado: EstadoVista;
}

function estadoDaTarefa(c: Checklist, i: ChecklistItem, ehHoje: boolean): EstadoVista {
  if (i.status === "concluido") return "concluido";
  if (!ehHoje) return "nao_iniciada";
  const ev = estadoVista(c);
  return ev === "atrasada" ? "atrasada" : ev === "nao_iniciada" ? "nao_iniciada" : "pendente";
}

/**
 * Linha da lista de tarefas do funcionário: check para concluir + título da
 * tarefa, a rotina a que pertence logo abaixo e, no fim da linha, horário, data
 * e o estado atual.
 */
function TarefaRow({
  tarefa,
  data,
  bloqueado,
}: {
  tarefa: TarefaFuncionario;
  data: Date;
  bloqueado: boolean;
}) {
  const { toggleItem } = useGCheck();
  const { checklist: c, item: i, estado: est } = tarefa;
  const feito = i.status === "concluido";
  // Tarefa que ainda não tem os anexos mínimos: bloqueia a conclusão até anexar.
  const anexosPendentes = i.anexos.length < i.minAnexos && !feito;
  const respostaPendente = i.tipoTarefa === "enquete" && !i.resposta && !feito;
  const travaConclusao = anexosPendentes || respostaPendente;

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 p-4">
      <button
        onClick={() => !bloqueado && !travaConclusao && !feito && toggleItem(c.id, i.id)}
        disabled={bloqueado || travaConclusao || feito}
        aria-label={
          bloqueado
            ? "Rotina desativada hoje"
            : feito
              ? `${i.titulo} concluída — só um administrador pode reabrir`
              : anexosPendentes
                ? `Anexe os arquivos para concluir ${i.titulo}`
                : respostaPendente
                  ? `Escolha uma resposta para concluir ${i.titulo}`
                  : `Concluir ${i.titulo}`
        }
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
          feito
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input hover:border-primary",
          (bloqueado || travaConclusao) && "cursor-not-allowed opacity-50 hover:border-input",
          feito && "cursor-default",
        )}
      >
        {feito && <Check className="size-3.5" />}
      </button>

      <div className="min-w-0 flex-1 basis-48">
        <p
          className={cn(
            "break-words text-sm font-medium",
            feito && "text-muted-foreground line-through",
          )}
        >
          {i.titulo}
        </p>
        <p className="truncate text-xs text-muted-foreground">{c.nome}</p>
        {(i.minAnexos > 0 || i.anexos.length > 0) && (
          <AnexosItem checklistId={c.id} item={i} podeEditar={!bloqueado && !feito} />
        )}
        {i.tipoTarefa === "enquete" && (
          <div className="mt-2 space-y-2">
            <EnqueteOpcoes checklistId={c.id} item={i} podeEditar={!bloqueado && !feito} />
            <JustificativaCampo
              checklistId={c.id}
              item={i}
              podeEditar={!bloqueado && !feito}
            />
          </div>
        )}
      </div>

      <div className="flex w-full shrink-0 items-center justify-between gap-3 pl-8 sm:w-auto sm:justify-end sm:pl-0">
        <div className="flex flex-col items-start gap-0.5 text-xs text-muted-foreground sm:items-end">
          {(i.horarioInicio || i.turno) && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" />{" "}
              {[
                i.turno,
                i.horarioInicio &&
                  (i.horarioTermino ? `${i.horarioInicio}–${i.horarioTermino}` : i.horarioInicio),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-3.5" /> {fmtDataTarefa.format(data)}
          </span>
        </div>
        <Badge
          variant="outline"
          className={cn("shrink-0 border-transparent font-medium", ESTADO_VISTA_UI[est].classe)}
        >
          {ESTADO_VISTA_UI[est].label}
        </Badge>
      </div>
    </li>
  );
}

function TarefasFuncionarioLista({
  tarefas,
  data,
  bloqueado,
  comFiltro,
  somenteLeitura = false,
}: {
  tarefas: TarefaFuncionario[];
  data: Date;
  bloqueado: boolean;
  comFiltro: boolean;
  somenteLeitura?: boolean | undefined;
}) {
  if (tarefas.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {comFiltro
          ? "Nenhuma tarefa para esse recorte."
          : somenteLeitura
            ? "Nenhuma tarefa sua nesse dia."
            : "Você não tem tarefas para hoje."}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {tarefas.map((t) => (
        <TarefaRow
          key={`${t.checklist.id}-${t.item.id}`}
          tarefa={t}
          data={data}
          bloqueado={bloqueado}
        />
      ))}
    </ul>
  );
}

function ChecklistsPage() {
  const { checklists, isLoading, isError } = useGCheck();
  const { session, isAdmin, profile } = useAuth();
  const { hojeISO, hojeDesativado } = useHojeDesativado();
  const {
    estados,
    turnos: turnosSearch,
    horarioDe,
    horarioAte,
    setores: setoresSearch,
    funcionarios: funcionariosSearch,
    checklist: checklistDestaque,
    dia,
    vista,
  } = Route.useSearch();
  const navigate = Route.useNavigate();

  // Dia em foco: sem "?dia=" (ou dia === hoje) é o dia corrente e tudo pode ser
  // marcado; "todas" mostra todas as atividades sem recorte; qualquer outro dia é
  // somente-leitura (abre para ver, não marca).
  const ehTodas = dia === "todas";
  const ehQuinzenal = dia === "quinzenal";
  const ehMensal = dia === "mensal";
  // Recortes que ignoram o dia do calendário (visões transversais só-leitura).
  const ehRecorteSemDia = ehTodas || ehQuinzenal || ehMensal;
  const ehHoje = !dia || dia === hojeISO;
  const ehPassado =
    !!dia && !ehHoje && !ehRecorteSemDia && dataDoIso(dia) < dataDoIso(hojeISO);
  const somenteLeitura = !ehHoje;

  // Registro de um dia já fechado (snapshot em checklist_execucoes) — leitura só
  // de admin (RLS). Alimenta as cards quando o admin navega para um dia passado.
  const execucoesDiaQuery = useQuery({
    queryKey: [...HISTORICO_QUERY_KEY, dia ?? "", dia ?? ""],
    queryFn: () => fetchExecucoes(dia ?? "", dia ?? ""),
    enabled: !!session && isAdmin && ehPassado,
  });

  const estadosSelecionados = React.useMemo(() => estados ?? [], [estados]);
  const turnosSelecionados = React.useMemo(() => turnosSearch ?? [], [turnosSearch]);
  const setoresSelecionados = React.useMemo(() => setoresSearch ?? [], [setoresSearch]);
  const funcionariosSelecionados = React.useMemo(
    () => funcionariosSearch ?? [],
    [funcionariosSearch],
  );

  // Opções de Setor / Funcionário saem das próprias rotinas (todas, não só as do
  // dia): assim o filtro cobre qualquer valor já cadastrado, mesmo fora do
  // recorte atual. Ordenadas em pt-BR, sem repetição e sem entradas vazias.
  const setoresDisponiveis = React.useMemo(() => {
    const nomes = new Set<string>();
    for (const c of checklists) {
      const s = c.setor.trim();
      if (s) nomes.add(s);
    }
    return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [checklists]);

  const funcionariosDisponiveis = React.useMemo(() => {
    const nomes = new Set<string>();
    for (const c of checklists) {
      for (const i of c.itens) {
        const r = i.responsavel.trim();
        if (r) nomes.add(r);
      }
    }
    return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [checklists]);

  // Horários de início realmente cadastrados nos itens ("HH:MM"), sem repetição
  // e em ordem crescente — viram sugestões (datalist) nos campos De/Até do filtro.
  const horariosDisponiveis = React.useMemo(() => {
    const valores = new Set<string>();
    for (const c of checklists) {
      for (const i of c.itens) {
        if (i.horarioInicio) valores.add(i.horarioInicio);
      }
    }
    return [...valores].sort((a, b) => a.localeCompare(b));
  }, [checklists]);

  const toggleEstado = React.useCallback(
    (id: EstadoVista) => {
      navigate({
        search: (prev) => {
          const atuais = prev.estados ?? [];
          const proximo = atuais.includes(id) ? atuais.filter((e) => e !== id) : [...atuais, id];
          return { ...prev, estados: proximo.length ? proximo : undefined };
        },
      });
    },
    [navigate],
  );

  const toggleTurno = React.useCallback(
    (id: Turno) => {
      navigate({
        search: (prev) => {
          const atuais = prev.turnos ?? [];
          const proximo = atuais.includes(id) ? atuais.filter((t) => t !== id) : [...atuais, id];
          return { ...prev, turnos: proximo.length ? proximo : undefined };
        },
      });
    },
    [navigate],
  );

  const mudarHorario = React.useCallback(
    (patch: { de?: string | undefined; ate?: string | undefined }) => {
      navigate({
        search: (prev) => ({
          ...prev,
          ...("de" in patch ? { horarioDe: patch.de || undefined } : {}),
          ...("ate" in patch ? { horarioAte: patch.ate || undefined } : {}),
        }),
      });
    },
    [navigate],
  );

  const toggleSetor = React.useCallback(
    (id: string) => {
      navigate({
        search: (prev) => {
          const atuais = prev.setores ?? [];
          const proximo = atuais.includes(id) ? atuais.filter((s) => s !== id) : [...atuais, id];
          return { ...prev, setores: proximo.length ? proximo : undefined };
        },
      });
    },
    [navigate],
  );

  const toggleFuncionario = React.useCallback(
    (id: string) => {
      navigate({
        search: (prev) => {
          const atuais = prev.funcionarios ?? [];
          const proximo = atuais.includes(id) ? atuais.filter((f) => f !== id) : [...atuais, id];
          return { ...prev, funcionarios: proximo.length ? proximo : undefined };
        },
      });
    },
    [navigate],
  );

  const limparFiltros = React.useCallback(() => {
    navigate({
      search: (prev) => ({
        ...prev,
        estados: undefined,
        turnos: undefined,
        horarioDe: undefined,
        horarioAte: undefined,
        setores: undefined,
        funcionarios: undefined,
      }),
    });
  }, [navigate]);

  const selecionarDia = React.useCallback(
    (iso: string | undefined) => {
      navigate({ search: (prev) => ({ ...prev, dia: iso || undefined }) });
    },
    [navigate],
  );

  const abrirCalendario = React.useCallback(() => {
    navigate({ search: (prev) => ({ ...prev, vista: "calendario" }) });
  }, [navigate]);

  const fecharCalendario = React.useCallback(() => {
    navigate({ search: (prev) => ({ ...prev, vista: undefined }) });
  }, [navigate]);

  const abrirDia = React.useCallback(
    (iso: string) => {
      navigate({ search: (prev) => ({ ...prev, dia: iso, vista: undefined }) });
    },
    [navigate],
  );

  if (isLoading) {
    return (
      <AppShell title="Checklists" subtitle="Rotinas operacionais da Loja Centro">
        <p className="text-sm text-muted-foreground">Carregando rotinas…</p>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell title="Checklists" subtitle="Rotinas operacionais da Loja Centro">
        <p className="text-sm text-destructive">Não foi possível carregar as rotinas.</p>
      </AppShell>
    );
  }

  const minhasChecklists = isAdmin
    ? checklists
    : checklists.filter((c) => c.ativo && c.itens.some((i) => ehResponsavel(i, profile?.nome)));

  if (vista === "calendario") {
    return (
      <AppShell title="Checklists" subtitle="Calendário de rotinas">
        <CalendarioChecklists
          checklists={minhasChecklists}
          diaInicial={ehRecorteSemDia ? undefined : dia}
          onVoltar={fecharCalendario}
          onAbrirDia={abrirDia}
        />
      </AppShell>
    );
  }

  // Data em foco: o dia escolhido no seletor ou hoje (nos recortes sem dia
  // — todas/quinzenal/mensal — não há data, então usa hoje só como referência).
  const dataAlvo = dia && !ehRecorteSemDia ? dataDoIso(dia) : new Date();
  const diaSelecionado = !!dia && !ehHoje;

  // Recorta a rotina para o dia em foco: mantém só as atividades cuja recorrência
  // (semanal/quinzenal/mensal, por item) cai em `dataAlvo`. Rotina sem nenhuma
  // atividade no dia é descartada mais abaixo.
  const recortarDia = (c: Checklist): Checklist => ({
    ...c,
    itens: c.itens.filter((i) => itemRodaNoDia(i, dataAlvo)),
  });

  // "?dia=quinzenal|mensal": mostra todas as rotinas, mas só com as atividades
  // daquela recorrência — visão transversal, sem recorte por dia.
  const recortarPorRecorrencia =
    (rec: ChecklistItem["recorrencia"]) =>
    (c: Checklist): Checklist => ({
      ...c,
      itens: c.itens.filter((i) => i.recorrencia === rec),
    });

  // Base de dados do dia em foco:
  //  - todas             -> todas as rotinas com todos os itens (somente leitura);
  //  - hoje              -> estado ao vivo (checklist_items), pode marcar;
  //  - passado (admin)   -> snapshot congelado em checklist_execucoes (já filtrado);
  //  - futuro, ou passado sem acesso ao histórico -> estrutura da rotina
  //    recortada para o dia, com todos os itens "pendente".
  // Nos casos que não são "hoje" as cards ficam somente-leitura.
  const checklistsDoDia: Checklist[] = (
    ehTodas
      ? minhasChecklists
      : ehQuinzenal
        ? minhasChecklists.map(recortarPorRecorrencia("quinzenal"))
        : ehMensal
          ? minhasChecklists.map(recortarPorRecorrencia("mensal"))
          : ehHoje
            ? minhasChecklists.map(recortarDia)
            : ehPassado && isAdmin
              ? (execucoesDiaQuery.data ?? []).map((e) =>
                  checklistDeSnapshot(
                    e,
                    checklists.find((c) => c.id === e.checklist_id),
                  ),
                )
              : minhasChecklists
                  .filter((c) => checklistVigenteNoDia(c, dataAlvo))
                  .map(recortarDia)
                  .map(checklistPendente)
  ).filter((c) => c.itens.length > 0);

  // Recorte por setor da rotina e por responsável de algum item — vale para
  // qualquer dia em foco, então roda antes das ramificações de estado abaixo.
  const passaSetorEFuncionario = (c: Checklist) => {
    if (setoresSelecionados.length > 0 && !setoresSelecionados.includes(c.setor.trim())) {
      return false;
    }
    if (
      funcionariosSelecionados.length > 0 &&
      !c.itens.some((i) => funcionariosSelecionados.includes(i.responsavel.trim()))
    ) {
      return false;
    }
    return true;
  };

  const passaTurno = (c: Checklist) =>
    turnosSelecionados.length === 0 ||
    c.turnos.some((t) => turnosSelecionados.includes(t as Turno));

  // Um "HH:MM" cai dentro do intervalo De–Até (qualquer limite pode faltar).
  const horarioNaFaixa = (hhmm: string | null) => {
    if (!hhmm) return false;
    if (horarioDe && hhmm < horarioDe) return false;
    if (horarioAte && hhmm > horarioAte) return false;
    return true;
  };

  // O filtro de horário age nas ATIVIDADES, não na rotina: com uma faixa De–Até
  // definida, cada card mostra só os itens que começam dentro dela — e o
  // progresso/estado passam a refletir esse recorte. Rotina que fica sem
  // nenhuma atividade no intervalo é descartada.
  const temFiltroHorario = !!horarioDe || !!horarioAte;
  const recortarHorario = (c: Checklist): Checklist => {
    if (!temFiltroHorario) return c;
    const itens = c.itens.filter((i) => horarioNaFaixa(i.horarioInicio));
    // Recalcula turnos/faixa do cabeçalho a partir só das atividades que restaram.
    return { ...c, itens, ...descricaoAgenda(itens) };
  };

  const lista = checklistsDoDia
    .map(recortarHorario)
    .filter((c) => {
      if (temFiltroHorario && c.itens.length === 0) return false;
      if (!passaTurno(c)) return false;
      if (!passaSetorEFuncionario(c)) return false;
      if (!ehHoje) {
        return (
          estadosSelecionados.length === 0 ||
          estadosSelecionados.includes(estadoVistaCard(c, false))
        );
      }
      return estadosSelecionados.length === 0 || estadosSelecionados.includes(estadoVista(c));
    });

  // Funcionário não vê a rotina inteira: percorre os itens atribuídos a ele
  // (nas rotinas que passam pelos mesmos filtros de turno/dia) e monta uma
  // lista plana de tarefas, ordenada pelo que precisa de ação primeiro.
  const tarefasFuncionario: TarefaFuncionario[] = isAdmin
    ? []
    : checklistsDoDia
        .filter((c) => passaTurno(c) && passaSetorEFuncionario(c))
        .flatMap((c) =>
          c.itens
            .filter((i) => ehResponsavel(i, profile?.nome))
            .filter((i) => {
              if (turnosSelecionados.length === 0) return true;
              const t = i.turno ?? turnoDoHorario(i.horarioInicio);
              return !t || turnosSelecionados.includes(t as Turno);
            })
            .filter((i) => (!horarioDe && !horarioAte) || horarioNaFaixa(i.horarioInicio))
            .map((i) => ({ checklist: c, item: i, estado: estadoDaTarefa(c, i, ehHoje) })),
        )
        .filter((t) => estadosSelecionados.length === 0 || estadosSelecionados.includes(t.estado))
        .sort(
          (a, b) =>
            (a.item.horarioInicio ?? a.checklist.horarioInicio ?? "99:99").localeCompare(
              b.item.horarioInicio ?? b.checklist.horarioInicio ?? "99:99",
            ) || a.item.titulo.localeCompare(b.item.titulo),
        );

  const temFiltro =
    estadosSelecionados.length > 0 ||
    turnosSelecionados.length > 0 ||
    !!horarioDe ||
    !!horarioAte ||
    setoresSelecionados.length > 0 ||
    funcionariosSelecionados.length > 0 ||
    diaSelecionado;

  const carregandoDia = ehPassado && isAdmin && execucoesDiaQuery.isLoading;

  return (
    <AppShell
      title="Checklists"
      subtitle={isAdmin ? "Rotinas operacionais da Loja Centro" : "Suas tarefas do dia"}
    >
      <div className="mx-auto max-w-4xl space-y-5">
        {hojeDesativado && <BannerRotinasPausadas hojeISO={hojeISO} />}

        {somenteLeitura && (
          <section className="flex items-center gap-3 rounded-2xl border border-border bg-muted/40 p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Eye className="size-4.5" />
            </span>
            <div>
              <p className="text-sm font-semibold capitalize">
                {ehTodas
                  ? "Todas as atividades"
                  : ehQuinzenal
                    ? "Atividades quinzenais"
                    : ehMensal
                      ? "Atividades mensais"
                      : fmtDiaLongo.format(dataAlvo)}
              </p>
              <p className="text-xs text-muted-foreground">
                {ehTodas
                  ? "Todas as atividades de todas as rotinas, independente do dia."
                  : ehQuinzenal
                    ? "Atividades com recorrência quinzenal, de todas as rotinas."
                    : ehMensal
                      ? "Atividades com recorrência mensal, de todas as rotinas."
                      : ehPassado
                        ? "Registro de um dia já fechado — somente leitura."
                        : "Este dia ainda não chegou — somente leitura."}{" "}
                As atividades só podem ser marcadas no dia programado.
              </p>
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <FiltrosChecklist
              estadosSelecionados={estadosSelecionados}
              turnosSelecionados={turnosSelecionados}
              horarioDe={horarioDe}
              horarioAte={horarioAte}
              setoresSelecionados={setoresSelecionados}
              funcionariosSelecionados={funcionariosSelecionados}
              horariosDisponiveis={horariosDisponiveis}
              setoresDisponiveis={setoresDisponiveis}
              funcionariosDisponiveis={funcionariosDisponiveis}
              onToggleEstado={toggleEstado}
              onToggleTurno={toggleTurno}
              onChangeHorario={mudarHorario}
              onToggleSetor={toggleSetor}
              onToggleFuncionario={toggleFuncionario}
              onLimpar={limparFiltros}
            />
            <SeletorDia
              diaSelecionado={dia}
              onSelectDia={selecionarDia}
              onVerCalendario={abrirCalendario}
              checklists={minhasChecklists}
            />
          </div>
          {isAdmin && <NovaChecklistDialog />}
        </div>

        {isAdmin ? (
          <div className="space-y-4">
            {carregandoDia ? (
              <p className="text-sm text-muted-foreground">Carregando registro do dia…</p>
            ) : (
              <>
                {lista.map((c) => (
                  <ChecklistCard
                    key={c.id}
                    c={c}
                    destacar={c.id === checklistDestaque}
                    travado={hojeDesativado}
                    somenteLeitura={somenteLeitura}
                    diaFechado={ehPassado}
                  />
                ))}
                {lista.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    {ehTodas
                      ? "Nenhuma rotina cadastrada."
                      : ehQuinzenal
                        ? "Nenhuma atividade quinzenal cadastrada."
                        : ehMensal
                          ? "Nenhuma atividade mensal cadastrada."
                          : somenteLeitura
                            ? ehPassado
                              ? "Nenhuma rotina registrada nesse dia."
                              : "Nenhuma atividade programada para esse dia."
                            : diaSelecionado
                              ? "Nenhuma atividade para o dia escolhido."
                              : temFiltroHorario
                                ? "Nenhuma atividade no horário escolhido."
                                : "Nenhuma rotina neste estado."}
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <TarefasFuncionarioLista
            tarefas={tarefasFuncionario}
            data={dataAlvo}
            bloqueado={hojeDesativado || somenteLeitura}
            comFiltro={temFiltro}
            somenteLeitura={somenteLeitura}
          />
        )}
      </div>
    </AppShell>
  );
}
