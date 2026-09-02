-- Histórico (checklist_execucoes) passa a ser leitura só de admin. Antes a
-- policy liberava SELECT para qualquer autenticado; a tela de Histórico agora é
-- exclusiva do admin (ver historico.tsx / app-shell.tsx), então a barreira de
-- dados acompanha. As funções de rollover são security definer e não dependem
-- desta policy.

drop policy if exists "autenticados veem execucoes" on checklist_execucoes;

create policy "admin ve execucoes"
  on checklist_execucoes for select
  to authenticated
  using (public.is_admin());
