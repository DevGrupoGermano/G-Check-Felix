import * as React from "react";
import { CalendarDays, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn, dataDoIso, isoDoDia } from "@/lib/utils";
import {
  checklistRodaNoDia,
  checklistVigenteNoDia,
  type Checklist,
} from "@/lib/g-check-store";

function mesmoDia(a: Date, b: Date) {
  return isoDoDia(a) === isoDoDia(b);
}

/**
 * Quantas rotinas ativas têm alguma atividade programada nesta data. A
 * recorrência vive por item (semanal/quinzenal/mensal), então "dia com tarefas"
 * = existe rotina ativa com ao menos uma atividade caindo naquele dia.
 */
function rotinasNoDia(checklists: Checklist[], date: Date): number {
  return checklists.filter(
    (c) => c.ativo && checklistVigenteNoDia(c, date) && checklistRodaNoDia(c, date),
  ).length;
}

const fmtCurto = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const fmtLongo = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
});

/**
 * Botão "Hoje ▾" ao lado dos filtros. O dropdown resume o dia selecionado e traz
 * um "Ver mais" que abre o calendário como tela própria dentro de /checklists
 * (ver CalendarioChecklists); escolher um dia aplica o filtro `?dia=` da página.
 */
export function SeletorDia({
  diaSelecionado,
  onSelectDia,
  onVerCalendario,
  checklists,
}: {
  diaSelecionado: string | undefined;
  onSelectDia: (iso: string | undefined) => void;
  onVerCalendario: () => void;
  checklists: Checklist[];
}) {
  const [open, setOpen] = React.useState(false);

  const hoje = React.useMemo(() => new Date(), []);
  const ehTodas = diaSelecionado === "todas";
  const dataSelecionada =
    diaSelecionado && !ehTodas ? dataDoIso(diaSelecionado) : undefined;
  const ehHoje = dataSelecionada ? mesmoDia(dataSelecionada, hoje) : false;
  const dataFoco = dataSelecionada ?? hoje;
  const contagem = rotinasNoDia(checklists, dataFoco);
  const rotulo = ehTodas
    ? "Todas"
    : !dataSelecionada || ehHoje
      ? "Hoje"
      : fmtCurto.format(dataSelecionada);

  function escolher(valor: Date | "todas" | undefined) {
    onSelectDia(valor === "todas" ? "todas" : valor ? isoDoDia(valor) : undefined);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={diaSelecionado ? "default" : "outline"} size="sm" className="gap-2">
          <CalendarDays className="size-4" />
          {rotulo}
          <ChevronDown
            className={cn(
              "size-4 transition-transform",
              open && "rotate-180",
              diaSelecionado ? "opacity-80" : "text-muted-foreground",
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="p-3">
          <p className="text-sm font-medium capitalize">
            {ehTodas ? "Todas as atividades" : fmtLongo.format(dataFoco)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ehTodas
              ? "Sem filtro por dia — todas as rotinas"
              : contagem === 0
                ? "Nenhuma rotina neste dia"
                : `${contagem} ${contagem === 1 ? "rotina" : "rotinas"} neste dia`}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={!diaSelecionado || ehHoje ? "default" : "secondary"}
              onClick={() => escolher(hoje)}
            >
              Hoje
            </Button>
            <Button
              size="sm"
              variant={ehTodas ? "default" : "secondary"}
              onClick={() => escolher("todas")}
            >
              Todas
            </Button>
            {diaSelecionado && (
              <Button size="sm" variant="ghost" onClick={() => escolher(undefined)}>
                Limpar
              </Button>
            )}
          </div>

          <Separator className="my-3" />

          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center gap-2"
            onClick={() => {
              setOpen(false);
              onVerCalendario();
            }}
          >
            <CalendarDays className="size-4" />
            Ver mais
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
