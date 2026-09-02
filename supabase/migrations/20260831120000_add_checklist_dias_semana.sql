-- Permite definir em quais dias da semana a rotina deve ser executada.
-- Guardado como array de inteiros 0..6 na ordem exibida no formulário
-- (0 = domingo, 1 = segunda, ... 6 = sábado -> D S T Q Q S S).
-- Default = todos os dias, para as rotinas já existentes seguirem valendo
-- todo dia sem precisar de ajuste manual.

alter table checklists
  add column if not exists dias_semana smallint[] not null default '{0,1,2,3,4,5,6}';
