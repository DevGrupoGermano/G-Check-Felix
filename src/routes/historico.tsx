import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CalendarOff, ChevronLeft, ChevronRight, List } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, celulasDoMes, dataDoIso, isoDoDia } from "@/lib/utils";
import { useAuth } from "@/lib/auth-store";
import { useGCheck } from "@/lib/g-check-store";
import {
  DIAS_DESATIVADOS_QUERY_KEY,
  fetchDiasDesativados,
} from "@/lib/dias-desativados";
import {
  fetchExecucoes,
  HISTORICO_QUERY_KEY,
  montarHistorico,
  type DiaHistorico,
  type StatusHistorico,
} from "@/lib/historico";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

interface HistoricoSearch {
  de?: string | undefined;
  ate?: string | undefined;
  vista?: "calendario" | undefined;
}

export const Route = createFileRoute("/historico")({
  head: () => ({ meta: [{ title: "Histórico de rotinas — G-check" }] }),
  validateSearch: (search: Record<string, unknown>): HistoricoSearch => {
    const de = typeof search["de"] === "string" && ISO_RE.test(search["de"]) ? search["de"] : undefined;
    const ate =
      typeof search["ate"] === "string" && ISO_RE.test(search["ate"]) ? search["ate"] : undefined;
    const vista = search["vista"] === "calendario" ? "calendario" : undefined;
    return { ...(de ? { de } : {}), ...(ate ? { ate } : {}), ...(vista ? { vista } : {}) };
  },
  component: HistoricoPage,
});

const fmtDiaSemana = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const fmtMesAno = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const CABECALHO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const ESTILO: Record<
  StatusHistorico,
  { label: string; dot: string; texto: string; pill: string }
> = {
  futura: {
    label: "Agendada",
    dot: "bg-muted-foreground/40",
    texto: "text-muted-foreground",
    pill: "bg-muted text-muted-foreground",
  },
  naoIniciada: {
    label: "Não iniciada",
    dot: "bg-muted-foreground/40",
    texto: "text-muted-foreground",
    pill: "bg-muted text-muted-foreground",
  },
  hoje: {
    label: "Pendente",
    dot: "bg-chart-4",
    texto: "text-chart-4",
    pill: "bg-chart-4/20 text-chart-4",
  },
  incompleta: {
    label: "Incompleta",
    dot: "bg-destructive",
    texto: "text-destructive",
    pill: "bg-destructive/15 text-destructive",
  },
  completa: {
    label: "Concluída",
    dot: "bg-success",
    texto: "text-success",
    pill: "bg-success/15 text-success",
  },
};

function inicioDoMes(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function fimDoMes(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function capitalizar(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Legenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {(Object.keys(ESTILO) as StatusHistorico[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", ESTILO[s].dot)} />
          {ESTILO[s].label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-chart-4" />
        Sem expediente
      </span>
    </div>
  );
}

function LinhaEntrada({ e }: { e: DiaHistorico["entradas"][number] }) {
  const st = ESTILO[e.status];
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
      <span className={cn("size-1.5 shrink-0 rounded-full", st.dot)} />
      <span className="font-medium">{e.nome}</span>
      <span className="text-xs text-muted-foreground">
        {e.turno} · {e.horario} · {e.setor}
      </span>
      <span className={cn("text-xs font-medium", st.texto)}>
        {st.label}
        {e.total > 0 && ` · ${e.feitos}/${e.total}`}
      </span>
    </li>
  );
}

function VistaLista({
  dias,
  hojeISO,
  onAbrirDia,
}: {
  dias: DiaHistorico[];
  hojeISO: string;
  onAbrirDia: (iso: string) => void;
}) {
  const alvoRef = React.useRef<HTMLLIElement>(null);
  React.useEffect(() => {
    alvoRef.current?.scrollIntoView({ block: "center" });
  }, [dias]);

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {dias.map((d) => {
        const ehHoje = d.iso === hojeISO;
        return (
          <li
            key={d.iso}
            ref={ehHoje ? alvoRef : undefined}
            className={cn(
              "relative flex gap-4 p-4 transition-colors hover:bg-muted/50",
              ehHoje && "bg-info/5",
            )}
          >
            {/* Botão que cobre a linha inteira: por ser posicionado, fica acima
                do conteúdo estático e captura o clique em qualquer ponto. */}
            <button
              type="button"
              onClick={() => onAbrirDia(d.iso)}
              aria-label={`Abrir checklist de ${d.data.toLocaleDateString("pt-BR")}`}
              className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            />
            <div className="flex w-12 shrink-0 flex-col items-center pt-0.5">
              <span
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  ehHoje ? "text-info" : "text-foreground",
                )}
              >
                {d.data.getDate()}
              </span>
              <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                {fmtDiaSemana.format(d.data).replace(".", "")}
              </span>
            </div>

            <div className="min-w-0 flex-1 self-center">
              {ehHoje && (
                <span className="mb-1.5 inline-block rounded-full bg-info px-2 py-0.5 text-[0.7rem] font-medium text-info-foreground">
                  Hoje
                </span>
              )}
              {d.pausado ? (
                <p className="inline-flex items-center gap-1.5 rounded-md bg-chart-4/15 px-2 py-1 text-xs font-medium text-chart-4">
                  <CalendarOff className="size-3.5" />
                  Sem expediente — rotinas desativadas
                </p>
              ) : d.entradas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem rotinas neste dia</p>
              ) : (
                <ul className="space-y-1.5">
                  {d.entradas.map((e) => (
                    <LinhaEntrada key={e.checklistId} e={e} />
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function VistaCalendario({
  mesRef,
  dias,
  hojeISO,
  onAbrirDia,
}: {
  mesRef: Date;
  dias: DiaHistorico[];
  hojeISO: string;
  onAbrirDia: (iso: string) => void;
}) {
  const porIso = React.useMemo(() => {
    const m = new Map<string, DiaHistorico>();
    for (const d of dias) m.set(d.iso, d);
    return m;
  }, [dias]);

  const celulas = React.useMemo(() => celulasDoMes(mesRef), [mesRef]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px] overflow-hidden rounded-2xl border border-border">
        <div className="grid grid-cols-7 gap-px bg-border">
          {CABECALHO.map((c) => (
            <div
              key={c}
              className="bg-card px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {c}
            </div>
          ))}

          {celulas.map((data) => {
            const iso = isoDoDia(data);
            const doMes = data.getMonth() === mesRef.getMonth();
            const ehHoje = iso === hojeISO;
            const dia = porIso.get(iso);
            const entradas = dia?.entradas ?? [];
            const visiveis = entradas.slice(0, 3);
            const resto = entradas.length - visiveis.length;
            return (
              <button
                key={iso}
                onClick={() => onAbrirDia(iso)}
                className={cn(
                  "flex min-h-32 flex-col gap-1.5 bg-card p-2 text-left align-top transition-colors hover:bg-muted/50",
                  !doMes && "bg-muted/20",
                  dia?.pausado && "bg-chart-4/5 hover:bg-chart-4/10",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                    ehHoje
                      ? "bg-info text-info-foreground"
                      : doMes
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {data.getDate()}
                </span>

                <div className="flex min-w-0 flex-col gap-1">
                  {dia?.pausado && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-chart-4/15 px-1.5 py-1 text-xs font-medium text-chart-4">
                      <CalendarOff className="size-3" />
                      Sem expediente
                    </span>
                  )}
                  {visiveis.map((e) => (
                    <span
                      key={e.checklistId}
                      title={`${e.nome} — ${ESTILO[e.status].label}`}
                      className={cn(
                        "truncate rounded-md px-1.5 py-1 text-xs font-medium",
                        ESTILO[e.status].pill,
                      )}
                    >
                      {e.horario} {e.nome}
                    </span>
                  ))}
                  {resto > 0 && (
                    <span className="px-1.5 text-xs text-muted-foreground">
                      +{resto} {resto > 1 ? "rotinas" : "rotina"}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HistoricoPage() {
  const { session, isAdmin, isLoading: authLoading } = useAuth();
  const { checklists, isLoading: carregandoChecklists } = useGCheck();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const hoje = React.useMemo(() => new Date(), []);
  const hojeISO = isoDoDia(hoje);

  const deDate = search.de ? dataDoIso(search.de) : inicioDoMes(hoje);
  const ateDate = search.ate ? dataDoIso(search.ate) : fimDoMes(hoje);
  const vista = search.vista ?? "lista";

  // Na visão calendário a busca cobre a grade inteira do mês (semanas que
  // "vazam" para o mês vizinho); na lista, só o intervalo escolhido.
  const grade = celulasDoMes(deDate);
  const rangeDe = vista === "calendario" ? grade[0]! : deDate;
  const rangeAte = vista === "calendario" ? grade[grade.length - 1]! : ateDate;
  const rangeDeISO = isoDoDia(rangeDe);
  const rangeAteISO = isoDoDia(rangeAte);

  const execucoesQuery = useQuery({
    queryKey: [...HISTORICO_QUERY_KEY, rangeDeISO, rangeAteISO],
    queryFn: () => fetchExecucoes(rangeDeISO, rangeAteISO),
    enabled: !!session && isAdmin,
  });

  const diasDesativadosQuery = useQuery({
    queryKey: DIAS_DESATIVADOS_QUERY_KEY,
    queryFn: fetchDiasDesativados,
    enabled: !!session && isAdmin,
  });

  const dias = React.useMemo(
    () =>
      montarHistorico({
        de: dataDoIso(rangeDeISO),
        ate: dataDoIso(rangeAteISO),
        hojeISO,
        execucoes: execucoesQuery.data ?? [],
        checklists,
        diasDesativados: new Set(diasDesativadosQuery.data ?? []),
      }),
    [rangeDeISO, rangeAteISO, hojeISO, execucoesQuery.data, checklists, diasDesativadosQuery.data],
  );

  function setPeriodo(deISO: string, ateISO: string) {
    navigate({ search: (p) => ({ ...p, de: deISO, ate: ateISO }) });
  }
  function irMesAtual() {
    setPeriodo(isoDoDia(inicioDoMes(hoje)), isoDoDia(fimDoMes(hoje)));
  }
  function mudarMes(delta: number) {
    const base = new Date(deDate.getFullYear(), deDate.getMonth() + delta, 1);
    setPeriodo(isoDoDia(inicioDoMes(base)), isoDoDia(fimDoMes(base)));
  }
  function setVista(v: "lista" | "calendario") {
    navigate({ search: (p) => ({ ...p, vista: v === "calendario" ? "calendario" : undefined }) });
  }
  // Clique num dia (calendário ou lista) leva direto à checklist daquela data,
  // já com o filtro de dia aplicado em /checklists (somente leitura fora de hoje).
  function abrirDia(iso: string) {
    navigate({ to: "/checklists", search: { dia: iso } });
  }

  const carregando = carregandoChecklists || execucoesQuery.isLoading;

  if (authLoading) return null;

  // Histórico é só para admin. A tabela checklist_execucoes também tem RLS
  // restringindo a leitura, então isto aqui é a barreira de UI.
  if (!isAdmin) {
    return (
      <AppShell title="Histórico">
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Acesso restrito a administradores.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Histórico" subtitle="Registro diário das rotinas">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              De
              <Input
                type="date"
                className="h-9 w-40"
                value={isoDoDia(deDate)}
                max={isoDoDia(ateDate)}
                onChange={(ev) => ev.target.value && setPeriodo(ev.target.value, isoDoDia(ateDate))}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Até
              <Input
                type="date"
                className="h-9 w-40"
                value={isoDoDia(ateDate)}
                min={isoDoDia(deDate)}
                onChange={(ev) => ev.target.value && setPeriodo(isoDoDia(deDate), ev.target.value)}
              />
            </label>
            <Button variant="ghost" size="sm" onClick={irMesAtual}>
              Mês atual
            </Button>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            <Button
              variant={vista === "lista" ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setVista("lista")}
            >
              <List className="size-4" />
              Lista
            </Button>
            <Button
              variant={vista === "calendario" ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setVista("calendario")}
            >
              <CalendarDays className="size-4" />
              Calendário
            </Button>
          </div>
        </div>

        {vista === "calendario" && (
          <div className="flex items-center justify-between gap-3">
            <Legenda />
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => mudarMes(-1)}
                aria-label="Mês anterior"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-40 text-center text-sm font-semibold capitalize">
                {capitalizar(fmtMesAno.format(deDate))}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => mudarMes(1)}
                aria-label="Próximo mês"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {vista === "lista" && <Legenda />}

        {carregando ? (
          <p className="text-sm text-muted-foreground">Carregando histórico…</p>
        ) : execucoesQuery.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar o histórico.</p>
        ) : vista === "calendario" ? (
          <VistaCalendario
            mesRef={inicioDoMes(deDate)}
            dias={dias}
            hojeISO={hojeISO}
            onAbrirDia={abrirDia}
          />
        ) : (
          <VistaLista dias={dias} hojeISO={hojeISO} onAbrirDia={abrirDia} />
        )}
      </div>
    </AppShell>
  );
}
