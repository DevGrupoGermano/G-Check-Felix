-- G-check: rotinas operacionais de supermercado
-- Modelo extraído de src/lib/g-check-store.tsx (Checklist / ChecklistItem)

create extension if not exists pgcrypto;

create table if not exists checklists (
  id text primary key,
  nome text not null,
  setor text not null,
  turno text not null check (turno in ('Manhã', 'Tarde', 'Noite')),
  horario time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists checklist_items (
  id text primary key,
  checklist_id text not null references checklists (id) on delete cascade,
  titulo text not null,
  detalhe text,
  responsavel text not null,
  status text not null default 'pendente' check (status in ('pendente', 'concluido')),
  posicao integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checklist_items_checklist_id_idx on checklist_items (checklist_id);
create index if not exists checklist_items_checklist_id_posicao_idx on checklist_items (checklist_id, posicao);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists checklists_set_updated_at on checklists;
create trigger checklists_set_updated_at
  before update on checklists
  for each row execute function set_updated_at();

drop trigger if exists checklist_items_set_updated_at on checklist_items;
create trigger checklist_items_set_updated_at
  before update on checklist_items
  for each row execute function set_updated_at();

-- RLS: app ainda não tem autenticação (chave anon fica exposta no frontend).
-- Liberado para anon como ambiente de demonstração; revisar antes de produção.
alter table checklists enable row level security;
alter table checklist_items enable row level security;

drop policy if exists "anon full access" on checklists;
create policy "anon full access"
  on checklists for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "anon full access" on checklist_items;
create policy "anon full access"
  on checklist_items for all
  to anon, authenticated
  using (true)
  with check (true);

-- Seed: mesmos dados de demonstração de demoChecklists em g-check-store.tsx
insert into checklists (id, nome, setor, turno, horario) values
  ('abertura', 'Abertura da loja', 'Operações', 'Manhã', '07:00'),
  ('reposicao', 'Reposição de gôndolas', 'Comercial', 'Manhã', '08:30'),
  ('validade', 'Controle de validade', 'Qualidade', 'Tarde', '14:00'),
  ('limpeza', 'Limpeza e higienização', 'Facilities', 'Tarde', '16:00'),
  ('fechamento', 'Fechamento da loja', 'Operações', 'Noite', '22:00')
on conflict (id) do nothing;

insert into checklist_items (id, checklist_id, titulo, detalhe, responsavel, status, posicao) values
  ('ab1', 'abertura', 'Conferir alarme e portas', 'Registrar qualquer ocorrência noturna.', 'Marcos R.', 'concluido', 1),
  ('ab2', 'abertura', 'Ligar iluminação e climatização', 'Checar corredores e área de frios.', 'Marcos R.', 'concluido', 2),
  ('ab3', 'abertura', 'Abrir caixas com fundo de troco', 'Conferir valor por operador.', 'Fernanda L.', 'concluido', 3),
  ('ab4', 'abertura', 'Checar temperatura das câmaras frias', 'Registrar °C de cada câmara.', 'Ana P.', 'pendente', 4),
  ('ab5', 'abertura', 'Briefing rápido com a equipe', 'Metas do dia e avisos.', 'Gerente de loja', 'pendente', 5),

  ('re1', 'reposicao', 'Verificar rupturas nos corredores 1 a 5', 'Anotar itens em falta.', 'João S.', 'concluido', 1),
  ('re2', 'reposicao', 'Repor bebidas e mercearia', 'Prioridade para itens de alto giro.', 'João S.', 'pendente', 2),
  ('re3', 'reposicao', 'Aplicar PVPS (primeiro a vencer, primeiro a sair)', 'Produtos novos ao fundo.', 'Carla M.', 'pendente', 3),
  ('re4', 'reposicao', 'Conferir etiquetas e preços', 'Sinalizar divergências ao fiscal.', 'Carla M.', 'pendente', 4),
  ('re5', 'reposicao', 'Organizar frente de gôndola', 'Facing alinhado e limpo.', 'Equipe de repositores', 'pendente', 5),

  ('va1', 'validade', 'Auditar laticínios e frios', 'Retirar itens a vencer em 3 dias.', 'Ana P.', 'concluido', 1),
  ('va2', 'validade', 'Auditar padaria e rotisseria', 'Verificar etiquetas de fabricação.', 'Rita F.', 'concluido', 2),
  ('va3', 'validade', 'Registrar perdas no sistema', 'Foto do produto retirado.', 'Ana P.', 'pendente', 3),
  ('va4', 'validade', 'Aplicar desconto em itens próximos ao vencimento', 'Etiqueta amarela.', 'Fiscal de loja', 'pendente', 4),

  ('li1', 'limpeza', 'Higienizar carrinhos e cestas', 'Solução sanitizante.', 'Equipe de limpeza', 'concluido', 1),
  ('li2', 'limpeza', 'Limpeza dos corredores e piso', 'Sinalizar piso molhado.', 'Equipe de limpeza', 'pendente', 2),
  ('li3', 'limpeza', 'Sanitizar balcões de frios e açougue', 'Registrar horário.', 'Pedro A.', 'pendente', 3),
  ('li4', 'limpeza', 'Checar banheiros e reposição de insumos', 'Papel, sabão e lixeiras.', 'Equipe de limpeza', 'pendente', 4),

  ('fe1', 'fechamento', 'Fechamento de caixas e sangria', 'Conferir com o relatório do dia.', 'Fernanda L.', 'pendente', 1),
  ('fe2', 'fechamento', 'Conferir temperatura final das câmaras', 'Registrar °C.', 'Pedro A.', 'pendente', 2),
  ('fe3', 'fechamento', 'Desligar equipamentos não essenciais', 'Manter refrigeração ativa.', 'Marcos R.', 'pendente', 3),
  ('fe4', 'fechamento', 'Recolher lixo e resíduos', 'Separar recicláveis.', 'Equipe de limpeza', 'pendente', 4),
  ('fe5', 'fechamento', 'Armar alarme e trancar acessos', 'Última checagem de portas.', 'Gerente de loja', 'pendente', 5)
on conflict (id) do nothing;
