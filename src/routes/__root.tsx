import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useNavigate,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { GCheckProvider } from "../lib/g-check-store";
import { AuthProvider, useAuth } from "../lib/auth-store";
import { Toaster } from "../components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "G-check — Rotinas de supermercado" },
      {
        name: "description",
        content:
          "Checklists operacionais para supermercados: pendências, conclusões e taxa de execução.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Guarda de rota client-side: nenhuma rota é protegida individualmente, este
 * componente único (renderizado no __root, acima do <Outlet />) decide se a
 * página pedida pode aparecer, com base na sessão do AuthProvider.
 *
 * - Sem sessão fora de /login → redireciona para /login.
 * - Com sessão em /login → redireciona para /.
 * - Enquanto isLoading, mostra um spinner simples (evita piscar a tela errada
 *   antes do Supabase confirmar se há sessão salva).
 *
 * O redirect roda em useEffect (depois do render), então nos dois casos de
 * redirecionamento retornamos null por um instante — a página protegida nunca
 * chega a ser exibida para quem não devia vê-la.
 * IMPORTANTE: isso é só UX; a proteção real dos dados é a RLS do Supabase e a
 * checagem de role no servidor (ver employees-fn.ts).
 */
function AuthGate({ children }: { children: ReactNode }) {
  const { session, isLoading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (!session && pathname !== "/login") {
      navigate({ to: "/login" });
    } else if (session && pathname === "/login") {
      navigate({ to: "/" });
    }
  }, [isLoading, session, pathname, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </div>
    );
  }

  if (!session && pathname !== "/login") return null;
  if (session && pathname === "/login") return null;

  return <>{children}</>;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Ordem importa: GCheckProvider chama useAuth() (precisa estar dentro de
          AuthProvider) e sua query só habilita com sessão presente — mas ele fica
          fora do AuthGate para já ter os dados prontos assim que o gate libera. */}
      <AuthProvider>
        <GCheckProvider>
          <AuthGate>
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
          </AuthGate>
          <Toaster />
        </GCheckProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
