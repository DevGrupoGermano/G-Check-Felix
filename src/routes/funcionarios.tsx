import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { ChevronRight, Pencil, Plus, ShieldCheck, Trash2, User } from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { useAuth, type Profile } from "@/lib/auth-store";
import { criarFuncionario, editarFuncionario, excluirFuncionario } from "@/lib/employees-fn";
import { fetchProfiles, PROFILES_QUERY_KEY } from "@/lib/profiles";
import { resumoDe, tarefasPorFuncionario, useGCheck } from "@/lib/g-check-store";

export const Route = createFileRoute("/funcionarios")({
  head: () => ({
    meta: [{ title: "Funcionários — G-check" }],
  }),
  component: FuncionariosPage,
});

const funcionarioSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome."),
  email: z.string().trim().min(1, "Informe o e-mail.").email("E-mail inválido."),
  senha: z.string().min(6, "A senha deve ter ao menos 6 caracteres."),
});

type FuncionarioValues = z.infer<typeof funcionarioSchema>;

function NovoFuncionarioDialog() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);

  const form = useForm<FuncionarioValues>({
    resolver: zodResolver(funcionarioSchema),
    defaultValues: { nome: "", email: "", senha: "" },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    form.reset();
  }

  async function onSubmit(values: FuncionarioValues) {
    if (!session) return;
    setEnviando(true);
    try {
      await criarFuncionario({
        data: {
          accessToken: session.access_token,
          nome: values.nome,
          email: values.email,
          senha: values.senha,
        },
      });
      toast.success("Funcionário cadastrado.");
      queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
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
          <Plus className="size-4" /> Novo funcionário
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo funcionário</DialogTitle>
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
                    <Input placeholder="Ex.: Ana Paula" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="ana@empresa.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="senha"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Senha provisória</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Ao menos 6 caracteres" {...field} />
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

const editarFuncionarioSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome."),
  email: z.string().trim().min(1, "Informe o e-mail.").email("E-mail inválido."),
  senha: z.union([z.string().min(6, "A senha deve ter ao menos 6 caracteres."), z.literal("")]),
});

type EditarFuncionarioValues = z.infer<typeof editarFuncionarioSchema>;

function EditarFuncionarioDialog({ profile }: { profile: Profile }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);

  const form = useForm<EditarFuncionarioValues>({
    resolver: zodResolver(editarFuncionarioSchema),
    defaultValues: { nome: profile.nome, email: profile.email, senha: "" },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    form.reset({ nome: profile.nome, email: profile.email, senha: "" });
  }

  async function onSubmit(values: EditarFuncionarioValues) {
    if (!session) return;
    setEnviando(true);
    try {
      await editarFuncionario({
        data: {
          accessToken: session.access_token,
          userId: profile.id,
          nome: values.nome,
          email: values.email,
          senha: values.senha,
        },
      });
      toast.success("Funcionário atualizado.");
      queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
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
          aria-label={`Editar ${profile.nome}`}
        >
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar funcionário</DialogTitle>
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
                    <Input placeholder="Ex.: Ana Paula" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="ana@empresa.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="senha"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nova senha (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Deixe em branco para manter a atual"
                      {...field}
                    />
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

function ExcluirFuncionarioButton({ profile }: { profile: Profile }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  async function onConfirm() {
    if (!session) return;
    try {
      await excluirFuncionario({
        data: { accessToken: session.access_token, userId: profile.id },
      });
      toast.success("Funcionário excluído.");
      queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
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
          aria-label={`Excluir ${profile.nome}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir “{profile.nome}”?</AlertDialogTitle>
          <AlertDialogDescription>
            A conta de {profile.email} e o acesso ao G-check serão removidos. Não dá para desfazer.
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

function FuncionariosPage() {
  const { isAdmin, isLoading: authLoading, session } = useAuth();
  const { checklists } = useGCheck();
  // O resumo de pendências de cada funcionário considera só as rotinas que rodam
  // hoje: a marca de "pendente" aparece quando a pessoa tem tarefa do dia ainda
  // não concluída.
  const porFuncionario = React.useMemo(
    () => tarefasPorFuncionario(checklists, new Date()),
    [checklists],
  );
  const query = useQuery({
    queryKey: PROFILES_QUERY_KEY,
    queryFn: fetchProfiles,
    enabled: isAdmin,
  });

  if (authLoading) return null;

  if (!isAdmin) {
    return (
      <AppShell title="Funcionários">
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Acesso restrito a administradores.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Funcionários" subtitle="Contas com acesso ao G-check">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {query.data
              ? `${query.data.length} ${query.data.length === 1 ? "funcionário" : "funcionários"}`
              : null}
          </span>
          <NovoFuncionarioDialog />
        </div>

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando funcionários…</p>
        )}
        {query.isError && (
          <p className="text-sm text-destructive">Não foi possível carregar os funcionários.</p>
        )}

        {query.data && (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-sm">
            {query.data.map((p) => {
              const resumo = resumoDe(porFuncionario, p.nome);
              return (
              <li key={p.id} className="flex items-center justify-between gap-3 p-4">
                <Link
                  to="/checklists"
                  search={{ funcionarios: [p.nome] }}
                  title={`Ver checklists de ${p.nome}`}
                  className="group -m-1 flex min-w-0 items-center gap-3 rounded-lg p-1 transition-colors hover:bg-muted/60"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <User className="size-4.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium group-hover:text-primary">
                      {p.nome}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
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
                  <Badge
                    variant="outline"
                    className={
                      p.role === "admin"
                        ? "gap-1 border-transparent bg-primary/12 text-primary"
                        : "gap-1 border-transparent bg-muted text-muted-foreground"
                    }
                  >
                    {p.role === "admin" && <ShieldCheck className="size-3" />}
                    {p.role === "admin" ? "Administrador" : "Funcionário"}
                  </Badge>
                  <EditarFuncionarioDialog profile={p} />
                  {p.id !== session?.user.id && <ExcluirFuncionarioButton profile={p} />}
                </div>
              </li>
              );
            })}
            {query.data.length === 0 && (
              <li className="p-8 text-center text-sm text-muted-foreground">
                Nenhum funcionário cadastrado ainda.
              </li>
            )}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
