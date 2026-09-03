import * as React from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn, dataDoIso, isoDoDia } from "@/lib/utils";
import { checklistRodaNoDia, type Checklist } from "@/lib/g-check-store";

const fmtMes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const CABECALHO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function capitalizar(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Grade do mês: começa no domingo antes do dia 1 e vai até fechar a última
 * semana, então cada célula (inclusive as de "fora do mês") é um Date real.
 */
function celulasDoMes(ref: Date): Date[] {
  const ano = ref.getFullYear();
  const mes = ref.getMonth();
  const offset = new Date(ano, mes, 1).getDay();
  const totalDias = new Date(ano, mes + 1, 0).getDate();
  const totalCelulas = Math.ceil((offset + totalDias) / 7) * 7;
  return Array.from({ length: totalCelulas }, (_, i) => new Date(ano, mes, i - offset + 1));
}

/**
 * Rotinas ativas com alguma atividade programada nesta data, ordenadas por
 * horário. A recorrência vive por item (semanal/quinzenal/mensal).
 */
function rotinasDoDia(checklists: Checklist[], date: Date): Checklist[] {
  return checklists
    .filter((c) => c.ativo && checklistRodaNoDia(c, date))
    .sort((a, b) => a.horario.localeCompare(b.horario));
}

/**
 * Tela de calendário da página /checklists (renderiza no <main>, header e sidebar
 * seguem). Grade mensal com células grandes: cada dia mostra as rotinas
 * agendadas; clicar num dia abre a lista já filtrada por aquele dia.
 */
export function CalendarioChecklists({
  checklists,
  diaInicial,
  onVoltar,
  onAbrirDia,
}: {
  checklists: Checklist[];
  diaInicial: string | undefined;
  onVoltar: () => void;
  onAbrirDia: (iso: string) => void;
}) {
  const hojeISO = isoDoDia(new Date());
  const alvoISO = diaInicial ?? hojeISO;
  const hoje = dataDoIso(hojeISO);

  const [mesRef, setMesRef] = React.useState(() => {
    const base = dataDoIso(alvoISO);
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const celulas = React.useMemo(() => celulasDoMes(mesRef), [mesRef]);
  const noMesDeHoje =
    mesRef.getFullYear() === hoje.getFullYear() && mesRef.getMonth() === hoje.getMonth();

  // Rola até o dia-alvo (hoje ou o dia que já vinha filtrado) ao abrir / trocar de mês.
  const alvoRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    alvoRef.current?.scrollIntoView({ block: "center" });
  }, [mesRef]);

  function mudarMes(delta: number) {
    setMesRef((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" className="gap-2" onClick={onVoltar}>
          <ArrowLeft className="size-4" />
          Voltar para a lista
        </Button>

        <div className="flex items-center gap-1.5">
          {!noMesDeHoje && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMesRef(new Date(hoje.getFullYear(), hoje.getMonth(), 1))}
            >
              Hoje
            </Button>
          )}
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
            {capitalizar(fmtMes.format(mesRef))}
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

      <div className="overflow-x-auto">
        <div className="min-w-[900px] overflow-hidden rounded-2xl border border-border">
          <div className="grid grid-cols-7 gap-px bg-border">
            {CABECALHO.map((d) => (
              <div
                key={d}
                className="bg-card px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                {d}
              </div>
            ))}

            {celulas.map((d) => {
              const iso = isoDoDia(d);
              const rotinas = rotinasDoDia(checklists, d);
              const doMes = d.getMonth() === mesRef.getMonth();
              const ehHoje = iso === hojeISO;
              const ehAlvo = iso === alvoISO;
              const visiveis = rotinas.slice(0, 3);
              const resto = rotinas.length - visiveis.length;
              return (
                <button
                  key={iso}
                  ref={ehAlvo ? alvoRef : undefined}
                  onClick={() => onAbrirDia(iso)}
                  className={cn(
                    "flex min-h-36 flex-col gap-1.5 bg-card p-2 text-left align-top transition-colors hover:bg-muted/50",
                    !doMes && "bg-muted/20",
                    ehAlvo && !ehHoje && "bg-primary/5",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                      ehHoje
                        ? "bg-primary text-primary-foreground"
                        : doMes
                          ? "text-foreground"
                          : "text-muted-foreground",
                    )}
                  >
                    {d.getDate()}
                  </span>

                  <div className="flex min-w-0 flex-col gap-1">
                    {visiveis.map((c) => (
                      <span
                        key={c.id}
                        title={`${c.nome} — ${c.turno} · ${c.horario} · ${c.setor}`}
                        className="truncate rounded-md bg-primary/10 px-1.5 py-1 text-xs font-medium text-primary"
                      >
                        {c.horario} {c.nome}
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
    </div>
  );
}
