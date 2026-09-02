import * as React from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type UserRole = "admin" | "funcionario";

export interface Profile {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
}

interface AuthCtx {
  session: Session | null;
  profile: Profile | null;
  isLoading: boolean;
  isAdmin: boolean;
  signIn: (email: string, senha: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  // Efeito 1: só cuida da sessão (token) do Supabase Auth — lê a sessão salva no
  // storage do browser ao montar e escuta login/logout/refresh de token depois.
  // "ativo" evita setState após o componente desmontar (efeitos assíncronos).
  React.useEffect(() => {
    let ativo = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!ativo) return;
      setSession(data.session);
      // Sem sessão não há perfil a buscar, então já libera o loading aqui;
      // com sessão, quem libera é o efeito 2 (depois de buscar o perfil).
      if (!data.session) setIsLoading(false);
    });

    const { data: assinatura } = supabase.auth.onAuthStateChange((_event, proximaSessao) => {
      if (!ativo) return;
      setSession(proximaSessao);
      if (!proximaSessao) {
        setProfile(null);
        setIsLoading(false);
      }
    });

    return () => {
      ativo = false;
      assinatura.subscription.unsubscribe();
    };
  }, []);

  // Efeito 2: sempre que a sessão muda, busca o perfil (nome/role) na tabela
  // "profiles". Separado do efeito 1 porque a sessão é assíncrona/reativa —
  // não dá pra buscar o perfil antes de saber que existe um usuário logado.
  React.useEffect(() => {
    if (!session) return;
    let ativo = true;
    setIsLoading(true);

    supabase
      .from("profiles")
      .select("id, nome, email, role")
      .eq("id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (!ativo) return;
        setProfile(error ? null : (data as Profile));
        setIsLoading(false);
      });

    return () => {
      ativo = false;
    };
  }, [session]);

  const signIn = React.useCallback(async (email: string, senha: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    return error ? { error: error.message } : {};
  }, []);

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = React.useMemo<AuthCtx>(
    () => ({
      session,
      profile,
      isLoading,
      // "admin" x "funcionario" controla navegação/UI aqui no client; a segurança
      // de verdade é imposta pelas policies de RLS no Supabase (o client nunca
      // deve ser a única barreira para dados sensíveis).
      isAdmin: profile?.role === "admin",
      signIn,
      signOut,
    }),
    [session, profile, isLoading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
