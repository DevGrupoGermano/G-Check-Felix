-- ---------------------------------------------------------------------------
-- Expondo só os NOMES das contas admin (sem email/permissões) pra qualquer
-- autenticado, via função security definer — contorna a RLS de profiles (que
-- só libera a lista completa pra quem tem 'cadastrar_funcionarios') sem abrir
-- a tabela inteira. Usado em /checklists para esconder de personalizados com
-- 'consultar_checklists_outros'/'marcar_checklists_outros' as rotinas cujo
-- responsável é uma conta admin — o nome já é público (aparece como
-- responsável nas checklists, visíveis a todo autenticado), então não expõe
-- nada de novo.
-- ---------------------------------------------------------------------------
create or replace function public.nomes_admin()
returns table (nome text)
language sql
stable
security definer
set search_path = public
as $$
  select p.nome from public.profiles p where p.role = 'admin';
$$;

grant execute on function public.nomes_admin() to authenticated;
