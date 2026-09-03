import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-store";
import { resumoDe, rodaNoDia, tarefasPorSetor, useGCheck } from "@/lib/g-check-store";
import {
  criarSetor,
  editarSetor,
  excluirSetor,
  fetchSetores,
  SETORES_QUERY_KEY,
  type Setor,
} from "@/lib/setores";

export const Route = createFileRoute("/setores")({
  head: () => ({
    meta: [{ title: "Setores — G-check" }],
  }),
  component: SetoresPage,
});

const setorSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome."),
  descricao: z.string().trim(),
});

type SetorValues = z.infer<typeof setorSchema>;

function NovoSetorDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);

  const form = useForm<SetorValues>({
    resolver: zodResolver(setorSchema),
    defaultValues: { nome: "", descricao: "" },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    form.reset();
  }

  async function onSubmit(values: SetorValues) {
    setEnviando(true);
    try {
      const idsExistentes = (queryClient.getQueryData<Setor[]>(SETORES_QUERY_KEY) ?? []).map(
        (s) => s.id,
      );
      await criarSetor(values, idsExistentes);
      toast.success("Setor cadastrado.");
      queryClient.invalidateQueries({ queryKey: SETORES_QUERY_KEY });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cadastrar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> Novo setor
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo setor</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="nome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex.: Açougue" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="descricao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição (opcional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Do que o setor cuida" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={enviando}>
                {enviando ? "Cadastrando…" : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EditarSetorDialog({ setor }: { setor: Setor }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);

  const form = useForm<SetorValues>({
    resolver: zodResolver(setorSchema),
    defaultValues: { nome: setor.nome, descricao: setor.descricao ?? "" },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    form.reset({ nome: setor.nome, descricao: setor.descricao ?? "" });
  }

  async function onSubmit(values: SetorValues) {
    setEnviando(true);
    try {
      await editarSetor(setor.id, values);
      toast.success("Setor atualizado.");
      queryClient.invalidateQueries({ queryKey: SETORES_QUERY_KEY });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Editar ${setor.nome}`}
        >
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar setor</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="nome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex.: Açougue" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="descricao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição (opcional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Do que o setor cuida" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={enviando}>
                {enviando ? "Salvando…" : "Salvar alterações"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ExcluirSetorButton({ setor }: { setor: Setor }) {
  const queryClient = useQueryClient();

  async function onConfirm() {
    try {
      await excluirSetor(setor.id);
      toast.success("Setor excluído.");
      queryClient.invalidateQueries({ queryKey: SETORES_QUERY_KEY });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir.");
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Excluir ${setor.nome}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir “{setor.nome}”?</AlertDialogTitle>
          <AlertDialogDescription>
            O setor sai do cadastro. Checklists que já usam esse nome não são alteradas.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SetoresPage() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const { checklists } = useGCheck();
  // Mesmo critério da página de funcionários: o resumo de pendências de cada
  // setor considera só as rotinas que rodam hoje, para ver as tarefas do dia.
  const porSetor = React.useMemo(
    () => tarefasPorSetor(checklists.filter((c) => c.ativo && rodaNoDia(c))),
    [checklists],
  );
  const query = useQuery({
    queryKey: SETORES_QUERY_KEY,
    queryFn: fetchSetores,
    enabled: isAdmin,
  });

  if (authLoading) return null;

  if (!isAdmin) {
    return (
      <AppShell title="Setores">
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Acesso restrito a administradores.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Setores" subtitle="Áreas da loja usadas nas checklists">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {query.data
              ? `${query.data.length} ${query.data.length === 1 ? "setor" : "setores"}`
              : null}
          </span>
          <NovoSetorDialog />
        </div>

        {query.isLoading && <p className="text-sm text-muted-foreground">Carregando setores…</p>}
        {query.isError && (
          <p className="text-sm text-destructive">Não foi possível carregar os setores.</p>
        )}

        {query.data && (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-sm">
            {query.data.map((s) => {
              const resumo = resumoDe(porSetor, s.nome);
              return (
              <li key={s.id} className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Building2 className="size-4.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.nome}</p>
                    {s.descricao && (
                      <p className="truncate text-xs text-muted-foreground">{s.descricao}</p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {resumo.total > 0 && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "border-transparent",
                        resumo.pendentes > 0
                          ? "bg-chart-4/20 text-chart-4"
                          : "bg-primary/12 text-primary",
                      )}
                      title={`${resumo.feitos} de ${resumo.total} tarefas concluídas`}
                    >
                      {resumo.pendentes > 0
                        ? `${resumo.pendentes} pendente${resumo.pendentes > 1 ? "s" : ""}`
                        : "em dia"}
                    </Badge>
                  )}
                  <EditarSetorDialog setor={s} />
                  <ExcluirSetorButton setor={s} />
                </div>
              </li>
              );
            })}
            {query.data.length === 0 && (
              <li className="p-8 text-center text-sm text-muted-foreground">
                Nenhum setor cadastrado ainda.
              </li>
            )}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
