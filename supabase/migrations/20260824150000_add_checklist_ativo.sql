-- Permite ativar/desativar uma rotina sem apagá-la. Rotinas inativas saem do
-- resumo operacional do dashboard e da visão do funcionário, mas continuam
-- editáveis pelo admin em /checklists.

alter table checklists add column if not exists ativo boolean not null default true;
