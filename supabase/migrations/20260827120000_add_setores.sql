-- ============================================================================
-- G-check — tabela de setores (rotina de cadastros)
-- ----------------------------------------------------------------------------
-- Cadastro próprio de setores, usado como referência ao criar/editar checklists.
-- Script idempotente: pode rodar mais de uma vez sem quebrar.
-- Depende de set_updated_at() e is_admin(), já criadas nas migrations anteriores
-- (ou no full_setup.sql).
-- ============================================================================

create table if not exists setores (
  id text primary key,
  nome text not null unique,
  descricao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists setores_set_updated_at on setores;
create trigger setores_set_updated_at
  before update on setores
  for each row execute function set_updated_at();

-- RLS: todo autenticado lê; só admin escreve (mesmo padrão de checklists).
alter table setores enable row level security;

drop policy if exists "autenticados veem setores" on setores;
drop policy if exists "admin cria setores" on setores;
drop policy if exists "admin atualiza setores" on setores;
drop policy if exists "admin remove setores" on setores;

create policy "autenticados veem setores"
  on setores for select
  to authenticated
  using (true);

create policy "admin cria setores"
  on setores for insert
  to authenticated
  with check (is_admin());

create policy "admin atualiza setores"
  on setores for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "admin remove setores"
  on setores for delete
  to authenticated
  using (is_admin());

-- Semente: os setores já usados no seed de checklists.
insert into setores (id, nome) values
  ('operacoes', 'Operações'),
  ('comercial', 'Comercial'),
  ('qualidade', 'Qualidade'),
  ('facilities', 'Facilities')
on conflict (id) do nothing;
