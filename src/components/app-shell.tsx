import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  Building2,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Store,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-store";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact: boolean;
};

const navBase: readonly NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/checklists", label: "Checklists", icon: ListChecks, exact: false },
];

// Seção só de admin. As rotas também se autoprotegem (ver historico.tsx /
// funcionarios.tsx / setores.tsx), então esconder aqui é só para não oferecer
// um link que levaria a uma tela de acesso negado.
const navAdmin: readonly NavItem[] = [
  { to: "/historico", label: "Histórico", icon: History, exact: false },
];

const navCadastros: readonly NavItem[] = [
  { to: "/funcionarios", label: "Funcionários", icon: Users, exact: false },
  { to: "/setores", label: "Setores", icon: Building2, exact: false },
];

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: (() => void) | undefined }) {
  const { to, label, icon: Icon, exact } = item;
  return (
    <Link
      to={to}
      onClick={onNavigate}
      activeOptions={{ exact }}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-primary/12 hover:text-primary data-[status=active]:bg-primary/12 data-[status=active]:font-semibold data-[status=active]:text-primary"
    >
      <Icon className="size-4.5" />
      {label}
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { isAdmin } = useAuth();

  return (
    <nav className="flex flex-col gap-1">
      {navBase.map((item) => (
        <NavLink key={item.to} item={item} onNavigate={onNavigate} />
      ))}

      {isAdmin && (
        <>
          {navAdmin.map((item) => (
            <NavLink key={item.to} item={item} onNavigate={onNavigate} />
          ))}
          <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            Rotina de cadastros
          </p>
          {navCadastros.map((item) => (
            <NavLink key={item.to} item={item} onNavigate={onNavigate} />
          ))}
        </>
      )}
    </nav>
  );
}

function UserFooter() {
  const { signOut } = useAuth();

  async function handleSignOut() {
    await signOut();
    window.location.assign("/login");
  }

  return (
    <button
      onClick={handleSignOut}
      className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-destructive/12 hover:text-destructive"
    >
      <LogOut className="size-4.5" />
      Sair
    </button>
  );
}

function iniciais(nome?: string | null) {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  const primeira = partes[0] ?? "";
  const ultima = partes[partes.length - 1] ?? "";
  if (!primeira) return "?";
  if (partes.length === 1) return primeira.slice(0, 2).toUpperCase();
  return (primeira[0]! + ultima[0]!).toUpperCase();
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
        <Store className="size-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-base font-semibold tracking-tight text-sidebar-foreground">
          G-check
        </span>
        <span className="block text-xs text-muted-foreground">Controle de Rotinas</span>
      </span>
    </div>
  );
}

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const { profile } = useAuth();

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:gap-6 lg:overflow-y-auto lg:p-4">
        <Brand />
        <NavLinks />
        <UserFooter />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Fechar menu"
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setOpen(false)}
          />
          <div className="relative flex h-full w-68 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4">
            <div className="flex items-center justify-between">
              <Brand />
              <button onClick={() => setOpen(false)} aria-label="Fechar menu">
                <X className="size-5 text-muted-foreground" />
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            <UserFooter />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur md:px-6">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu className="size-4.5" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight md:text-lg">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <span
            title={profile?.nome ?? undefined}
            className="ml-auto flex size-8 shrink-0 select-none items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow"
          >
            {iniciais(profile?.nome)}
          </span>
        </header>
        <main className={cn("flex-1 px-4 py-6 md:px-8 md:py-8")}>{children}</main>
      </div>
    </div>
  );
}
