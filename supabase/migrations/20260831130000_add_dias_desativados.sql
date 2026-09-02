-- Feriado / dia sem expediente: marca um dia inteiro como desativado. Enquanto a
-- data de hoje estiver nesta tabela, o dashboard não cobra as pendências do dia.
-- É reversível (o admin apaga a linha para reativar) e não altera nenhuma
-- checklist — o agendamento por dia da semana (checklists.dias_semana) continua
-- valendo nos demais dias.

create table if not exists dias_desativados (
  data date primary key,
  criado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table dias_desativados enable row level security;

drop policy if exists "autenticados veem dias desativados" on dias_desativados;
drop policy if exists "admin desativa dia" on dias_desativados;
drop policy if exists "admin reativa dia" on dias_desativados;

-- Todo autenticado lê (o funcionário também vê "rotinas pausadas hoje");
-- só admin desativa/reativa.
create policy "autenticados veem dias desativados"
  on dias_desativados for select
  to authenticated
  using (true);

create policy "admin desativa dia"
  on dias_desativados for insert
  to authenticated
  with check (is_admin());

create policy "admin reativa dia"
  on dias_desativados for delete
  to authenticated
  using (is_admin());
