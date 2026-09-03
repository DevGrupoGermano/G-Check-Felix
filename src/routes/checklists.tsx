import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarDays,
  CalendarOff,
  Camera,
  Check,
  ChevronDown,
  Clock,
  Eye,
  Filter,
  Loader2,
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
  ehResponsavel,
  labelDiasSemana,
  progresso,
  rodaNoDia,
  turnos,
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
  if (c.tempoLimite && agoraMin > minutosHHMM(c.tempoLimite)) return "atrasada";
  if (feitos > 0) return "em_andamento";
  // Nada feito e dentro do prazo: "pendente" quando o horário da rotina já
  // chegou; senão ainda está fora da janela de programação = "não iniciada".
  return agoraMin >= minutosHHMM(c.horario) ? "pendente" : "nao_iniciada";
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
 * sentido derivar "atrasada" pelo relógio atual. `vivo` (a rotina ainda existente
 * de mesmo id) só empresta os dias da semana / status ativo para o cabeçalho.
 */
function checklistDeSnapshot(e: ChecklistExecucaoRow, vivo: Checklist | undefined): Checklist {
  return {
    id: e.checklist_id,
    nome: e.nome,
    setor: e.setor,
    turno: e.turno,
    horario: e.horario.slice(0, 5),
    ativo: vivo?.ativo ?? true,
    diasSemana: vivo?.diasSemana ?? [dataDoIso(e.data).getDay()],
    itens: (e.itens ?? []).map((it, idx) => ({
      id: `${e.checklist_id}-snap-${idx}`,
      titulo: it.titulo,
      responsavel: it.responsavel,
      status: it.status === "concluido" ? "concluido" : "pendente",
      exigeFoto: it.exige_foto ?? false,
      ...(it.foto_url ? { fotoUrl: it.foto_url } : {}),
    })),
  };
}

/** Cópia da rotina com todo item "pendente" — usada em dias que ainda não chegaram. */
function checklistPendente(c: Checklist): Checklist {
  return {
    id: c.id,
    nome: c.nome,
    setor: c.setor,
    turno: c.turno,
    horario: c.horario,
    ativo: c.ativo,
    diasSemana: c.diasSemana,
    // Dia que ainda não chegou: sem status e sem a foto do dia de hoje.
    itens: c.itens.map(({ fotoUrl: _fotoUrl, ...i }) => ({
      ...i,
      status: "pendente" as const,
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
  /** Nomes de setores para recortar as rotinas (casa com `checklist.setor`). */
  setores?: string[] | undefined;
  /** Nomes de responsáveis: mantém as rotinas que têm ao menos um item da pessoa. */
  funcionarios?: string[] | undefined;
  /** id da checklist que deve abrir expandida e receber scroll ao entrar na página. */
  checklist?: string | undefined;
  /** dia (ISO "yyyy-MM-dd") escolhido no seletor "Hoje": filtra pelas rotinas daquele dia da semana. */
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
    // Setores/funcionários são texto livre (vêm do cadastro): só filtramos por tipo.
    const setores = Array.isArray(rawSetores)
      ? rawSetores.filter((s): s is string => typeof s === "string" && s.length > 0)
      : undefined;
    const funcionarios = Array.isArray(rawFuncionarios)
      ? rawFuncionarios.filter((f): f is string => typeof f === "string" && f.length > 0)
      : undefined;
    const checklist = typeof rawChecklist === "string" ? rawChecklist : undefined;
    const dia =
      typeof rawDia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDia) ? rawDia : undefined;
    const vista = rawVista === "calendario" ? "calendario" : undefined;

    return {
      ...(estados && estados.length ? { estados } : {}),
      ...(turnosSearch && turnosSearch.length ? { turnos: turnosSearch } : {}),
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
  setoresSelecionados,
  funcionariosSelecionados,
  setoresDisponiveis,
  funcionariosDisponiveis,
  onToggleEstado,
  onToggleTurno,
  onToggleSetor,
  onToggleFuncionario,
  onLimpar,
}: {
  estadosSelecionados: EstadoVista[];
  turnosSelecionados: Turno[];
  setoresSelecionados: string[];
  funcionariosSelecionados: string[];
  setoresDisponiveis: string[];
  funcionariosDisponiveis: string[];
  onToggleEstado: (id: EstadoVista) => void;
  onToggleTurno: (id: Turno) => void;
  onToggleSetor: (id: string) => void;
  onToggleFuncionario: (id: string) => void;
  onLimpar: () => void;
}) {
  const total =
    estadosSelecionados.length +
    turnosSelecionados.length +
    setoresSelecionados.length +
    funcionariosSelecionados.length;

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

/**
 * Anexo de foto de comprovação de um item. Quando `podeEditar`, mostra o botão
 * de câmera (abre a galeria/câmera do aparelho); caso contrário fica só com a
 * miniatura clicável (dia fechado / somente leitura). A trava de "não conclui
 * sem foto" mora no store (toggleItem) e no banco (trigger).
 */
function AnexoFoto({
  checklistId,
  item,
  podeEditar,
}: {
  checklistId: string;
  item: ChecklistItem;
  podeEditar: boolean;
}) {
  const { anexarFoto, removerFoto } = useGCheck();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = React.useState(false);

  async function aoEscolher(ev: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = ev.target.files?.[0];
    ev.target.value = "";
    if (!arquivo) return;
    setEnviando(true);
    try {
      await anexarFoto(checklistId, item.id, arquivo);
    } catch {
      /* erro já sinalizado por toast no store */
    } finally {
      setEnviando(false);
    }
  }

  async function aoRemover() {
    setEnviando(true);
    try {
      await removerFoto(checklistId, item.id);
    } catch {
      /* toast no store */
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {item.fotoUrl ? (
        <a href={item.fotoUrl} target="_blank" rel="noreferrer" className="shrink-0">
          <img
            src={item.fotoUrl}
            alt={`Foto de ${item.titulo}`}
            className="size-14 rounded-lg border border-border object-cover"
          />
        </a>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-1 text-xs font-medium text-muted-foreground">
          <Camera className="size-3" />
          {podeEditar ? "Foto obrigatória" : "Sem foto"}
        </span>
      )}

      {podeEditar && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
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
              <Camera className="size-3.5" />
            )}
            {item.fotoUrl ? "Trocar" : "Anexar foto"}
          </Button>
          {item.fotoUrl && (
            <button
              type="button"
              onClick={aoRemover}
              disabled={enviando}
              aria-label="Remover foto"
              className="rounded-full p-1 text-muted-foreground hover:bg-foreground/10 hover:text-destructive disabled:opacity-50"
            >
              <X className="size-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ChecklistCard({
  c,
  destacar = false,
  travado = false,
  foraDoDia = false,
  somenteLeitura = false,
  diaFechado = false,
}: {
  c: Checklist;
  destacar?: boolean | undefined;
  /** Dia pausado (feriado): itens não podem ser marcados/concluídos/reabertos. */
  travado?: boolean | undefined;
  /** Rotina não programada para hoje (diasSemana) — aparece "desativada". */
  foraDoDia?: boolean | undefined;
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
  // Dia pausado ou fora da programação: a rotina não abre nem aceita marcação —
  // o card fica só com o cabeçalho. "somenteLeitura" (outro dia) ainda abre.
  const bloqueado = travado || foraDoDia;
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
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" /> {c.turno} · {c.horario}
                  {c.tempoLimite && ` · até ${c.tempoLimite}`}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="size-3.5" /> {labelDiasSemana(c.diasSemana)}
                </span>
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
              // Item que pede foto e ainda não tem: não dá pra concluir (só reabrir).
              const fotoPendente = i.exigeFoto && !i.fotoUrl && !feito;
              return (
                <li key={i.id} className="flex items-start gap-3 py-3">
                  <button
                    onClick={() => podeMarcar && !fotoPendente && toggleItem(c.id, i.id)}
                    disabled={!podeMarcar || fotoPendente}
                    aria-label={
                      bloqueado
                        ? "Rotina desativada hoje"
                        : somenteLeitura
                          ? "Somente leitura — abra o dia de hoje para marcar"
                          : !podeMarcar
                            ? `Item atribuído a ${i.responsavel}`
                            : fotoPendente
                              ? `Anexe uma foto para concluir ${i.titulo}`
                              : feito
                                ? `Reabrir ${i.titulo}`
                                : `Concluir ${i.titulo}`
                    }
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                      feito
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input hover:border-primary",
                      (!podeMarcar || fotoPendente) &&
                        "cursor-not-allowed opacity-50 hover:border-input",
                    )}
                  >
                    {feito && <Check className="size-3.5" />}
                  </button>
                  <div className="min-w-0">
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
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <User className="size-3" /> {i.responsavel}
                    </p>
                    {i.exigeFoto && (
                      <AnexoFoto
                        checklistId={c.id}
                        item={i}
                        podeEditar={podeMarcar && !feito}
                      />
                    )}
                  </div>
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
  // Tarefa que exige foto e ainda não tem: bloqueia a conclusão até anexar.
  const fotoPendente = i.exigeFoto && !i.fotoUrl && !feito;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
      <button
        onClick={() => !bloqueado && !fotoPendente && toggleItem(c.id, i.id)}
        disabled={bloqueado || fotoPendente}
        aria-label={
          bloqueado
            ? "Rotina desativada hoje"
            : fotoPendente
              ? `Anexe uma foto para concluir ${i.titulo}`
              : feito
                ? `Reabrir ${i.titulo}`
                : `Concluir ${i.titulo}`
        }
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
          feito
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input hover:border-primary",
          (bloqueado || fotoPendente) && "cursor-not-allowed opacity-50 hover:border-input",
        )}
      >
        {feito && <Check className="size-3.5" />}
      </button>

      <div className="min-w-0 flex-1 basis-48">
        <p
          className={cn(
            "truncate text-sm font-medium",
            feito && "text-muted-foreground line-through",
          )}
        >
          {i.titulo}
        </p>
        <p className="truncate text-xs text-muted-foreground">{c.nome}</p>
        {i.exigeFoto && (
          <AnexoFoto checklistId={c.id} item={i} podeEditar={!bloqueado && !feito} />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 pl-8 sm:pl-0">
        <div className="flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" /> {c.horario}
            {c.tempoLimite && ` · até ${c.tempoLimite}`}
          </span>
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
    setores: setoresSearch,
    funcionarios: funcionariosSearch,
    checklist: checklistDestaque,
    dia,
    vista,
  } = Route.useSearch();
  const navigate = Route.useNavigate();

  // Dia em foco: sem "?dia=" (ou dia === hoje) é o dia corrente e tudo pode ser
  // marcado; qualquer outro dia é somente-leitura (abre para ver, não marca).
  const ehHoje = !dia || dia === hojeISO;
  const ehPassado = !!dia && !ehHoje && dataDoIso(dia) < dataDoIso(hojeISO);
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
          diaInicial={dia}
          onVoltar={fecharCalendario}
          onAbrirDia={abrirDia}
        />
      </AppShell>
    );
  }

  // "?dia=" traz um dia específico do calendário; como as tarefas só têm dia da
  // semana (checklist.diasSemana), o filtro casa pelo getDay() daquela data.
  const diaSemanaAlvo = dia ? dataDoIso(dia).getDay() : null;

  // Data mostrada em cada tarefa: o dia escolhido no seletor ou hoje.
  const dataAlvo = dia ? dataDoIso(dia) : new Date();

  // Sem "?dia=", rotina não programada para hoje aparece "desativada" (bloqueada).
  // Funcionário nem vê; admin vê marcada. Filtro de estado esconde essas (não têm
  // estado do dia).
  const foraDoDia = (c: Checklist) => diaSemanaAlvo === null && !rodaNoDia(c);

  // Base de dados do dia em foco:
  //  - hoje              -> estado ao vivo (checklist_items), pode marcar;
  //  - passado (admin)   -> snapshot congelado em checklist_execucoes;
  //  - futuro, ou passado sem acesso ao histórico -> estrutura da rotina programada
  //    para aquele dia da semana, com todos os itens "pendente".
  // Nos dois últimos casos as cards ficam somente-leitura.
  const checklistsDoDia: Checklist[] = ehHoje
    ? minhasChecklists
    : ehPassado && isAdmin
      ? (execucoesDiaQuery.data ?? []).map((e) =>
          checklistDeSnapshot(
            e,
            checklists.find((c) => c.id === e.checklist_id),
          ),
        )
      : minhasChecklists
          .filter((c) => c.diasSemana.includes(dataAlvo.getDay()))
          .map(checklistPendente);

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

  const lista = checklistsDoDia.filter((c) => {
    if (turnosSelecionados.length > 0 && !turnosSelecionados.includes(c.turno as Turno)) {
      return false;
    }
    if (!passaSetorEFuncionario(c)) return false;
    if (!ehHoje) {
      return (
        estadosSelecionados.length === 0 ||
        estadosSelecionados.includes(estadoVistaCard(c, false))
      );
    }
    if (diaSemanaAlvo !== null && !c.diasSemana.includes(diaSemanaAlvo)) return false;
    if (foraDoDia(c)) return isAdmin && estadosSelecionados.length === 0;
    return estadosSelecionados.length === 0 || estadosSelecionados.includes(estadoVista(c));
  });

  // Funcionário não vê a rotina inteira: percorre os itens atribuídos a ele
  // (nas rotinas que passam pelos mesmos filtros de turno/dia) e monta uma
  // lista plana de tarefas, ordenada pelo que precisa de ação primeiro.
  const tarefasFuncionario: TarefaFuncionario[] = isAdmin
    ? []
    : checklistsDoDia
        .filter((c) => {
          if (turnosSelecionados.length > 0 && !turnosSelecionados.includes(c.turno as Turno)) {
            return false;
          }
          if (!passaSetorEFuncionario(c)) return false;
          if (!ehHoje) return true;
          if (diaSemanaAlvo !== null && !c.diasSemana.includes(diaSemanaAlvo)) return false;
          return !foraDoDia(c);
        })
        .flatMap((c) =>
          c.itens
            .filter((i) => ehResponsavel(i, profile?.nome))
            .map((i) => ({ checklist: c, item: i, estado: estadoDaTarefa(c, i, ehHoje) })),
        )
        .filter((t) => estadosSelecionados.length === 0 || estadosSelecionados.includes(t.estado))
        .sort(
          (a, b) =>
            a.checklist.horario.localeCompare(b.checklist.horario) ||
            a.item.titulo.localeCompare(b.item.titulo),
        );

  const temFiltro =
    estadosSelecionados.length > 0 ||
    turnosSelecionados.length > 0 ||
    setoresSelecionados.length > 0 ||
    funcionariosSelecionados.length > 0 ||
    diaSemanaAlvo !== null;

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
              <p className="text-sm font-semibold capitalize">{fmtDiaLongo.format(dataAlvo)}</p>
              <p className="text-xs text-muted-foreground">
                {ehPassado
                  ? "Registro de um dia já fechado — somente leitura."
                  : "Este dia ainda não chegou — somente leitura."}{" "}
                As rotinas só podem ser marcadas no dia de hoje.
              </p>
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <FiltrosChecklist
              estadosSelecionados={estadosSelecionados}
              turnosSelecionados={turnosSelecionados}
              setoresSelecionados={setoresSelecionados}
              funcionariosSelecionados={funcionariosSelecionados}
              setoresDisponiveis={setoresDisponiveis}
              funcionariosDisponiveis={funcionariosDisponiveis}
              onToggleEstado={toggleEstado}
              onToggleTurno={toggleTurno}
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
                    foraDoDia={ehHoje ? foraDoDia(c) : false}
                    somenteLeitura={somenteLeitura}
                    diaFechado={ehPassado}
                  />
                ))}
                {lista.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    {somenteLeitura
                      ? ehPassado
                        ? "Nenhuma rotina registrada nesse dia."
                        : "Nenhuma rotina programada para esse dia."
                      : diaSemanaAlvo !== null
                        ? "Nenhuma rotina para o dia escolhido."
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
