-- Login + papéis (admin / funcionário).
-- Só o admin pode criar contas de funcionário (via server function com service_role) e
-- criar/editar/apagar checklists. Funcionário só executa (marca item, conclui/reabre rotina).

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  email text not null,
  role text not null default 'funcionario' check (role in ('admin', 'funcionario')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Cria o perfil automaticamente quando um usuário é criado no Auth
-- (usado pela server function que cadastra funcionários com auth.admin.createUser).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nome, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', new.email),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'role', 'funcionario')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- security definer para evitar recursão de RLS ao checar o papel do usuário logado
-- dentro das próprias policies de profiles/checklists/checklist_items.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

alter table profiles enable row level security;

drop policy if exists "ver o proprio perfil" on profiles;
create policy "ver o proprio perfil"
  on profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "admin ve todos os perfis" on profiles;
create policy "admin ve todos os perfis"
  on profiles for select
  to authenticated
  using (is_admin());

drop policy if exists "admin atualiza perfis" on profiles;
create policy "admin atualiza perfis"
  on profiles for update
  to authenticated
  using (is_admin())
  with check (is_admin());

-- Substitui o acesso público (anon) das checklists por acesso restrito a
-- usuários autenticados; escrita (insert/update/delete) só para admin.
drop policy if exists "anon full access" on checklists;

create policy "autenticados veem checklists"
  on checklists for select
  to authenticated
  using (true);

create policy "admin cria checklists"
  on checklists for insert
  to authenticated
  with check (is_admin());

create policy "admin atualiza checklists"
  on checklists for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "admin remove checklists"
  on checklists for delete
  to authenticated
  using (is_admin());

drop policy if exists "anon full access" on checklist_items;

create policy "autenticados veem itens"
  on checklist_items for select
  to authenticated
  using (true);

create policy "admin insere itens"
  on checklist_items for insert
  to authenticated
  with check (is_admin());

-- Update fica liberado para qualquer autenticado (funcionário precisa marcar
-- item concluído/pendente); o trigger abaixo bloqueia funcionário alterando
-- título/detalhe/responsável/posição — só o status.
create policy "autenticados atualizam itens"
  on checklist_items for update
  to authenticated
  using (true)
  with check (true);

create policy "admin remove itens"
  on checklist_items for delete
  to authenticated
  using (is_admin());

create or replace function public.checklist_items_restrict_funcionario_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.titulo is distinct from old.titulo
    or new.detalhe is distinct from old.detalhe
    or new.responsavel is distinct from old.responsavel
    or new.posicao is distinct from old.posicao
    or new.checklist_id is distinct from old.checklist_id
  then
    raise exception 'Apenas administradores podem editar os itens da checklist.';
  end if;

  return new;
end;
$$;

drop trigger if exists checklist_items_restrict_funcionario_update on checklist_items;
create trigger checklist_items_restrict_funcionario_update
  before update on checklist_items
  for each row execute function public.checklist_items_restrict_funcionario_update();

-- Bootstrap do primeiro admin (rodar manualmente depois de criar o usuário pelo
-- Dashboard do Supabase em Authentication > Users, ou pela tela de login com uma
-- conta criada via server function):
--
--   update profiles set role = 'admin' where email = 'seu-email@dominio.com';
