import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { CalendarClock, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  diasDaSemana,
  recorrencias,
  todosOsDias,
  turnos,
  useGCheck,
  type Checklist,
  type Recorrencia,
} from "@/lib/g-check-store";
import { fetchProfiles, PROFILES_QUERY_KEY } from "@/lib/profiles";
import { fetchSetores, SETORES_QUERY_KEY } from "@/lib/setores";
import { cn } from "@/lib/utils";

const itemSchema = z
  .object({
    itemId: z.string().optional(),
    titulo: z.string().trim().min(1, "Informe o título do item."),
    detalhe: z.string().trim().optional(),
    responsavel: z.string().trim().min(1, "Informe o responsável."),
    minAnexos: z.coerce
      .number()
      .int("Use um número inteiro.")
      .min(0, "Não pode ser negativo.")
      .max(10, "No máximo 10."),
    recorrencia: z.enum(recorrencias),
    diasSemana: z.array(z.number()),
    inicio: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.recorrencia === "semanal" && v.diasSemana.length === 0) {
      ctx.addIssue({ code: "custom", path: ["diasSemana"], message: "Selecione ao menos um dia." });
    }
    if (v.recorrencia !== "semanal" && !v.inicio) {
      ctx.addIssue({ code: "custom", path: ["inicio"], message: "Escolha a data de início." });
    }
  });

const checklistSchema = z
  .object({
    nome: z.string().trim().min(1, "Informe o nome da checklist."),
    setor: z.string().trim().min(1, "Informe o setor."),
    turno: z.enum(turnos, { message: "Selecione o turno." }),
    horario: z.string().trim().min(1, "Informe o horário."),
    tempoLimite: z.string().trim(),
    ativo: z.boolean(),
    itens: z.array(itemSchema).min(1, "Adicione ao menos um item."),
  })
  .refine((v) => !v.tempoLimite || !v.horario || v.tempoLimite >= v.horario, {
    message: "O tempo limite deve ser igual ou depois do horário de início.",
    path: ["tempoLimite"],
  });

type ChecklistFormValues = z.infer<typeof checklistSchema>;

const itemVazio = {
  titulo: "",
  detalhe: "",
  responsavel: "",
  minAnexos: 0,
  recorrencia: "semanal" as Recorrencia,
  diasSemana: [...todosOsDias],
  inicio: "",
};

function turnoOuPadrao(turno: string): (typeof turnos)[number] {
  return (turnos as readonly string[]).includes(turno)
    ? (turno as (typeof turnos)[number])
    : turnos[0];
}

function valoresPadrao(checklist?: Checklist): ChecklistFormValues {
  if (!checklist) {
    return {
      nome: "",
      setor: "",
      turno: turnos[0],
      horario: "",
      tempoLimite: "",
      ativo: true,
      itens: [itemVazio],
    };
  }
  return {
    nome: checklist.nome,
    setor: checklist.setor,
    turno: turnoOuPadrao(checklist.turno),
    horario: checklist.horario,
    tempoLimite: checklist.tempoLimite ?? "",
    ativo: checklist.ativo,
    itens: checklist.itens.map((i) => ({
      itemId: i.id,
      titulo: i.titulo,
      detalhe: i.detalhe ?? "",
      responsavel: i.responsavel,
      minAnexos: i.minAnexos,
      recorrencia: i.recorrencia,
      diasSemana: i.diasSemana.length > 0 ? [...i.diasSemana] : [...todosOsDias],
      inicio: i.inicio ?? "",
    })),
  };
}

function ChecklistFormDialog({ checklist }: { checklist?: Checklist }) {
  const { criarChecklist, editarChecklist } = useGCheck();
  const [open, setOpen] = React.useState(false);
  const editando = !!checklist;

  const form = useForm<ChecklistFormValues>({
    resolver: zodResolver(checklistSchema),
    defaultValues: valoresPadrao(checklist),
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "itens",
  });

  const { data: funcionarios = [] } = useQuery({
    queryKey: PROFILES_QUERY_KEY,
    queryFn: fetchProfiles,
    enabled: open,
  });
  const nomesFuncionarios = Array.from(new Set(funcionarios.map((f) => f.nome)));

  const { data: setores = [] } = useQuery({
    queryKey: SETORES_QUERY_KEY,
    queryFn: fetchSetores,
    enabled: open,
  });
  const nomesSetores = Array.from(new Set(setores.map((s) => s.nome)));

  function onOpenChange(next: boolean) {
    setOpen(next);
    form.reset(valoresPadrao(checklist));
  }

  function onSubmit(values: ChecklistFormValues) {
    // "itemId" só existe em itens que vieram de uma checklist existente
    // (setado em valoresPadrao); itens adicionados no formulário não têm.
    // O store (editarChecklist) usa essa presença/ausência para decidir se
    // preserva o status do item ou o cria do zero — ver g-check-store.tsx.
    const itens = values.itens.map((i) => {
      const detalhe = i.detalhe?.trim();
      return {
        ...(i.itemId ? { id: i.itemId } : {}),
        titulo: i.titulo,
        responsavel: i.responsavel,
        minAnexos: i.minAnexos,
        recorrencia: i.recorrencia,
        diasSemana: [...i.diasSemana].sort((a, b) => a - b),
        inicio: i.inicio || null,
        ...(detalhe ? { detalhe } : {}),
      };
    });

    const dados = {
      nome: values.nome,
      setor: values.setor,
      turno: values.turno,
      horario: values.horario,
      ativo: values.ativo,
      ...(values.tempoLimite.trim() ? { tempoLimite: values.tempoLimite.trim() } : {}),
      itens,
    };
    if (editando && checklist) {
      editarChecklist(checklist.id, dados);
    } else {
      criarChecklist(dados);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {editando ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`Editar ${checklist.nome}`}
          >
            <Pencil className="size-4" />
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="size-4" /> Nova checklist
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar checklist" : "Nova checklist"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Nome da checklist</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex.: Inventário de bebidas" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="setor"
                render={({ field }) => {
                  // Só dá pra escolher um setor cadastrado; se a checklist já
                  // tinha um setor que foi removido depois, ele entra na lista
                  // como opção extra para não sumir ao editar.
                  const opcoes =
                    field.value && !nomesSetores.includes(field.value)
                      ? [field.value, ...nomesSetores]
                      : nomesSetores;
                  return (
                    <FormItem>
                      <FormLabel>Setor</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione um setor" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {opcoes.length === 0 && (
                            <p className="px-2 py-1.5 text-sm text-muted-foreground">
                              Nenhum setor cadastrado
                            </p>
                          )}
                          {opcoes.map((nome) => (
                            <SelectItem key={nome} value={nome}>
                              {nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
              <FormField
                control={form.control}
                name="turno"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Turno</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {turnos.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="horario"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Horário</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tempoLimite"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tempo limite (opcional)</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Passou daqui sem concluir, a rotina fica “Atrasada”.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ativo"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-xl border border-border p-3 sm:col-span-2">
                    <div className="space-y-0.5">
                      <FormLabel>Rotina ativa</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Rotinas inativas saem do dashboard e da visão dos funcionários.
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Itens da checklist</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => append(itemVazio)}>
                  <Plus className="size-4" /> Adicionar item
                </Button>
              </div>

              {form.formState.errors.itens?.message && (
                <p className="text-[0.8rem] font-medium text-destructive">
                  {form.formState.errors.itens.message}
                </p>
              )}

              <div className="space-y-4">
                {fields.map((f, index) => (
                  <div key={f.id} className="space-y-3 rounded-xl border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground">Item {index + 1}</p>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6 text-muted-foreground hover:text-destructive"
                        onClick={() => remove(index)}
                        disabled={fields.length === 1}
                        aria-label={`Remover item ${index + 1}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <FormField
                      control={form.control}
                      name={`itens.${index}.titulo`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Título</FormLabel>
                          <FormControl>
                            <Input placeholder="Ex.: Conferir contagem de estoque" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`itens.${index}.detalhe`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Detalhe (opcional)</FormLabel>
                          <FormControl>
                            <Textarea rows={2} placeholder="Instruções adicionais" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`itens.${index}.responsavel`}
                      render={({ field }) => {
                        const opcoes =
                          field.value && !nomesFuncionarios.includes(field.value)
                            ? [field.value, ...nomesFuncionarios]
                            : nomesFuncionarios;
                        return (
                          <FormItem>
                            <FormLabel>Responsável</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione um funcionário" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {opcoes.length === 0 && (
                                  <p className="px-2 py-1.5 text-sm text-muted-foreground">
                                    Nenhum funcionário cadastrado
                                  </p>
                                )}
                                {opcoes.map((nome) => (
                                  <SelectItem key={nome} value={nome}>
                                    {nome}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                    <FormField
                      control={form.control}
                      name={`itens.${index}.minAnexos`}
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between gap-3 rounded-lg border border-border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="flex items-center gap-1.5">
                              <Paperclip className="size-3.5" />
                              Anexos obrigatórios para concluir
                            </FormLabel>
                            <p className="text-xs text-muted-foreground">
                              0 = opcional. Ex.: 2 exige dois arquivos (foto, vídeo ou documento).
                            </p>
                          </div>
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              max={10}
                              inputMode="numeric"
                              className="w-16 text-center"
                              value={field.value}
                              onChange={(e) => field.onChange(Number(e.target.value) || 0)}
                              onBlur={field.onBlur}
                              name={field.name}
                              ref={field.ref}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`itens.${index}.recorrencia`}
                      render={({ field }) => {
                        const rec = field.value as Recorrencia;
                        return (
                          <FormItem className="rounded-lg border border-border p-3">
                            <FormLabel className="flex items-center gap-1.5">
                              <CalendarClock className="size-3.5" />
                              Recorrência
                            </FormLabel>
                            <FormControl>
                              <div className="mt-1 inline-flex rounded-lg border border-input p-0.5">
                                {recorrencias.map((r) => (
                                  <button
                                    key={r}
                                    type="button"
                                    onClick={() => field.onChange(r)}
                                    aria-pressed={rec === r}
                                    className={cn(
                                      "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                                      rec === r
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:text-foreground",
                                    )}
                                  >
                                    {r}
                                  </button>
                                ))}
                              </div>
                            </FormControl>

                            {rec === "semanal" ? (
                              <FormField
                                control={form.control}
                                name={`itens.${index}.diasSemana`}
                                render={({ field: dias }) => (
                                  <FormItem className="mt-2">
                                    <FormControl>
                                      <div className="flex flex-wrap gap-2">
                                        {diasDaSemana.map((dia) => {
                                          const on = dias.value.includes(dia.valor);
                                          return (
                                            <button
                                              key={dia.valor}
                                              type="button"
                                              onClick={() =>
                                                dias.onChange(
                                                  on
                                                    ? dias.value.filter(
                                                        (v: number) => v !== dia.valor,
                                                      )
                                                    : [...dias.value, dia.valor].sort(
                                                        (a, b) => a - b,
                                                      ),
                                                )
                                              }
                                              aria-pressed={on}
                                              aria-label={dia.nome}
                                              title={dia.nome}
                                              className={cn(
                                                "flex size-9 items-center justify-center rounded-full border text-sm font-medium transition-colors",
                                                on
                                                  ? "border-primary bg-primary text-primary-foreground"
                                                  : "border-input text-muted-foreground hover:border-primary hover:text-foreground",
                                              )}
                                            >
                                              {dia.inicial}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            ) : (
                              <FormField
                                control={form.control}
                                name={`itens.${index}.inicio`}
                                render={({ field: ini }) => (
                                  <FormItem className="mt-2">
                                    <FormLabel className="text-xs font-normal text-muted-foreground">
                                      Começa em
                                    </FormLabel>
                                    <FormControl>
                                      <Input type="date" className="w-44" {...ini} />
                                    </FormControl>
                                    <p className="text-xs text-muted-foreground">
                                      {rec === "quinzenal"
                                        ? "Repete a cada 14 dias a partir desta data."
                                        : "Repete todo mês neste dia (mês curto → último dia)."}
                                    </p>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            )}
                          </FormItem>
                        );
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit">{editando ? "Salvar alterações" : "Criar checklist"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function NovaChecklistDialog() {
  return <ChecklistFormDialog />;
}

export function EditarChecklistDialog({ checklist }: { checklist: Checklist }) {
  return <ChecklistFormDialog checklist={checklist} />;
}
