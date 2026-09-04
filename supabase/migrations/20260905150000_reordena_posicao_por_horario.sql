-- ============================================================================
-- G-check — corrige a ordem de exibição (posicao) das atividades das rotinas
-- ----------------------------------------------------------------------------
-- A carga inicial (20260905130000_seed_checklists_felix.sql) numerou `posicao`
-- na ordem das linhas da planilha original, não na ordem cronológica do
-- horário de cada atividade — por isso atividades das 18h apareciam no meio
-- das atividades das 7h (e vários outros casos assim) na tela de checklists.
-- Esta migration renumera `posicao` por horario_inicio (crescente) em cada
-- rotina, preservando a ordem relativa original entre itens de mesmo horário.
-- Os gatilhos checklist_items_restrict_funcionario_update (bloqueia alteração
-- de posicao fora de admin) e checklist_items_block_on_disabled_day (bloqueia
-- alteração de item que não roda hoje) barram isso fora de uma sessão de admin
-- (auth.uid() fica nulo rodando SQL puro) — usamos o mesmo bypass que o
-- rollover diário já usa (app.bypass_item_guard), só durante esta transação.
-- ============================================================================

begin;

set local app.bypass_item_guard = 'on';

-- gerente (70 itens reordenados)
update checklist_items as t set posicao = v.posicao
from (values
  ('gerente-3', 74),
  ('gerente-4', 3),
  ('gerente-5', 4),
  ('gerente-6', 5),
  ('gerente-7', 6),
  ('gerente-8', 7),
  ('gerente-9', 8),
  ('gerente-10', 9),
  ('gerente-11', 58),
  ('gerente-12', 10),
  ('gerente-13', 61),
  ('gerente-14', 72),
  ('gerente-15', 11),
  ('gerente-16', 12),
  ('gerente-17', 13),
  ('gerente-18', 14),
  ('gerente-19', 15),
  ('gerente-20', 16),
  ('gerente-21', 17),
  ('gerente-22', 18),
  ('gerente-23', 30),
  ('gerente-24', 19),
  ('gerente-25', 31),
  ('gerente-26', 32),
  ('gerente-27', 33),
  ('gerente-28', 34),
  ('gerente-29', 35),
  ('gerente-30', 36),
  ('gerente-31', 37),
  ('gerente-32', 48),
  ('gerente-33', 65),
  ('gerente-34', 49),
  ('gerente-35', 38),
  ('gerente-36', 50),
  ('gerente-37', 62),
  ('gerente-38', 39),
  ('gerente-39', 63),
  ('gerente-42', 51),
  ('gerente-43', 64),
  ('gerente-44', 66),
  ('gerente-45', 73),
  ('gerente-46', 47),
  ('gerente-47', 42),
  ('gerente-48', 59),
  ('gerente-49', 67),
  ('gerente-50', 52),
  ('gerente-51', 20),
  ('gerente-52', 21),
  ('gerente-53', 22),
  ('gerente-54', 53),
  ('gerente-55', 68),
  ('gerente-56', 54),
  ('gerente-57', 69),
  ('gerente-58', 23),
  ('gerente-59', 24),
  ('gerente-60', 25),
  ('gerente-61', 43),
  ('gerente-62', 60),
  ('gerente-63', 70),
  ('gerente-64', 44),
  ('gerente-65', 45),
  ('gerente-66', 26),
  ('gerente-67', 55),
  ('gerente-68', 71),
  ('gerente-69', 56),
  ('gerente-70', 57),
  ('gerente-71', 46),
  ('gerente-72', 27),
  ('gerente-73', 28),
  ('gerente-74', 29)
) as v(id, posicao)
where t.id = v.id;

-- lider-acougue-diurno (8 itens reordenados)
update checklist_items as t set posicao = v.posicao
from (values
  ('lider-acougue-diurno-1', 2),
  ('lider-acougue-diurno-2', 1),
  ('lider-acougue-diurno-18', 22),
  ('lider-acougue-diurno-19', 18),
  ('lider-acougue-diurno-20', 19),
  ('lider-acougue-diurno-21', 20),
  ('lider-acougue-diurno-22', 23),
  ('lider-acougue-diurno-23', 21)
) as v(id, posicao)
where t.id = v.id;

-- lider-acougue-noturno (6 itens reordenados)
update checklist_items as t set posicao = v.posicao
from (values
  ('lider-acougue-noturno-16', 20),
  ('lider-acougue-noturno-17', 22),
  ('lider-acougue-noturno-18', 16),
  ('lider-acougue-noturno-19', 17),
  ('lider-acougue-noturno-20', 18),
  ('lider-acougue-noturno-22', 19)
) as v(id, posicao)
where t.id = v.id;

-- lider-adega (9 itens reordenados)
update checklist_items as t set posicao = v.posicao
from (values
  ('lider-adega-13', 18),
  ('lider-adega-14', 19),
  ('lider-adega-15', 21),
  ('lider-adega-16', 13),
  ('lider-adega-17', 14),
  ('lider-adega-18', 15),
  ('lider-adega-19', 16),
  ('lider-adega-20', 17),
  ('lider-adega-21', 20)
) as v(id, posicao)
where t.id = v.id;

-- lider-cafe (9 itens reordenados)
update checklist_items as t set posicao = v.posicao
from (values
  ('lider-cafe-13', 18),
  ('lider-cafe-14', 20),
  ('lider-cafe-15', 21),
  ('lider-cafe-16', 13),
  ('lider-cafe-17', 14),
  ('lider-cafe-18', 15),
  ('lider-cafe-19', 16),
  ('lider-cafe-20', 17),
  ('lider-cafe-21', 19)
) as v(id, posicao)
where t.id = v.id;

-- lider-cerveja (8 itens reordenados)
update checklist_items as t set posicao = v.posicao
from (values
  ('lider-cerveja-13', 19),
  ('lider-cerveja-14', 20),
  ('lider-cerveja-15', 13),
  ('lider-cerveja-16', 14),
  ('lider-cerveja-17', 15),
  ('lider-cerveja-18', 16),
  ('lider-cerveja-19', 17),
  ('lider-cerveja-20', 18)
) as v(id, posicao)
where t.id = v.id;

-- lider-limpeza (8 itens reordenados)
update checklist_items as t set posicao = v.posicao
from (values
  ('lider-limpeza-13', 19),
  ('lider-limpeza-14', 20),
  ('lider-limpeza-15', 13),
  ('lider-limpeza-16', 14),
  ('lider-limpeza-17', 15),
  ('lider-limpeza-18', 16),
  ('lider-limpeza-19', 17),
  ('lider-limpeza-20', 18)
) as v(id, posicao)
where t.id = v.id;

-- lider-patio (27 itens reordenados)
update checklist_items as t set posicao = v.posicao
from (values
  ('lider-patio-6', 24),
  ('lider-patio-7', 27),
  ('lider-patio-8', 29),
  ('lider-patio-9', 32),
  ('lider-patio-10', 6),
  ('lider-patio-11', 7),
  ('lider-patio-12', 8),
  ('lider-patio-13', 9),
  ('lider-patio-14', 10),
  ('lider-patio-15', 11),
  ('lider-patio-16', 25),
  ('lider-patio-17', 26),
  ('lider-patio-18', 28),
  ('lider-patio-19', 30),
  ('lider-patio-20', 12),
  ('lider-patio-21', 31),
  ('lider-patio-22', 13),
  ('lider-patio-23', 14),
  ('lider-patio-24', 15),
  ('lider-patio-25', 16),
  ('lider-patio-26', 17),
  ('lider-patio-27', 18),
  ('lider-patio-28', 19),
  ('lider-patio-29', 20),
  ('lider-patio-30', 21),
  ('lider-patio-31', 22),
  ('lider-patio-32', 23)
) as v(id, posicao)
where t.id = v.id;

-- lider-pereciveis (8 itens reordenados)
update checklist_items as t set posicao = v.posicao
from (values
  ('lider-pereciveis-11', 16),
  ('lider-pereciveis-12', 11),
  ('lider-pereciveis-13', 17),
  ('lider-pereciveis-14', 12),
  ('lider-pereciveis-15', 13),
  ('lider-pereciveis-16', 14),
  ('lider-pereciveis-17', 18),
  ('lider-pereciveis-18', 15)
) as v(id, posicao)
where t.id = v.id;

-- sub-gerente-diurno (78 itens reordenados)
update checklist_items as t set posicao = v.posicao
from (values
  ('sub-gerente-diurno-1', 3),
  ('sub-gerente-diurno-2', 78),
  ('sub-gerente-diurno-3', 26),
  ('sub-gerente-diurno-4', 54),
  ('sub-gerente-diurno-5', 27),
  ('sub-gerente-diurno-6', 55),
  ('sub-gerente-diurno-7', 28),
  ('sub-gerente-diurno-8', 56),
  ('sub-gerente-diurno-9', 4),
  ('sub-gerente-diurno-10', 5),
  ('sub-gerente-diurno-11', 6),
  ('sub-gerente-diurno-12', 7),
  ('sub-gerente-diurno-13', 8),
  ('sub-gerente-diurno-14', 9),
  ('sub-gerente-diurno-15', 39),
  ('sub-gerente-diurno-16', 50),
  ('sub-gerente-diurno-17', 61),
  ('sub-gerente-diurno-18', 62),
  ('sub-gerente-diurno-19', 63),
  ('sub-gerente-diurno-20', 64),
  ('sub-gerente-diurno-21', 65),
  ('sub-gerente-diurno-22', 66),
  ('sub-gerente-diurno-23', 67),
  ('sub-gerente-diurno-24', 68),
  ('sub-gerente-diurno-25', 10),
  ('sub-gerente-diurno-26', 69),
  ('sub-gerente-diurno-27', 11),
  ('sub-gerente-diurno-28', 12),
  ('sub-gerente-diurno-29', 1),
  ('sub-gerente-diurno-30', 2),
  ('sub-gerente-diurno-31', 29),
  ('sub-gerente-diurno-32', 44),
  ('sub-gerente-diurno-33', 40),
  ('sub-gerente-diurno-34', 35),
  ('sub-gerente-diurno-35', 45),
  ('sub-gerente-diurno-36', 57),
  ('sub-gerente-diurno-37', 13),
  ('sub-gerente-diurno-38', 14),
  ('sub-gerente-diurno-39', 15),
  ('sub-gerente-diurno-40', 36),
  ('sub-gerente-diurno-41', 42),
  ('sub-gerente-diurno-42', 51),
  ('sub-gerente-diurno-43', 60),
  ('sub-gerente-diurno-44', 37),
  ('sub-gerente-diurno-45', 43),
  ('sub-gerente-diurno-46', 52),
  ('sub-gerente-diurno-47', 38),
  ('sub-gerente-diurno-48', 31),
  ('sub-gerente-diurno-49', 32),
  ('sub-gerente-diurno-50', 46),
  ('sub-gerente-diurno-51', 47),
  ('sub-gerente-diurno-52', 70),
  ('sub-gerente-diurno-53', 33),
  ('sub-gerente-diurno-54', 34),
  ('sub-gerente-diurno-55', 48),
  ('sub-gerente-diurno-56', 58),
  ('sub-gerente-diurno-57', 16),
  ('sub-gerente-diurno-58', 17),
  ('sub-gerente-diurno-59', 30),
  ('sub-gerente-diurno-60', 49),
  ('sub-gerente-diurno-61', 59),
  ('sub-gerente-diurno-62', 41),
  ('sub-gerente-diurno-63', 71),
  ('sub-gerente-diurno-64', 53),
  ('sub-gerente-diurno-65', 72),
  ('sub-gerente-diurno-66', 73),
  ('sub-gerente-diurno-67', 74),
  ('sub-gerente-diurno-68', 75),
  ('sub-gerente-diurno-69', 18),
  ('sub-gerente-diurno-70', 19),
  ('sub-gerente-diurno-71', 20),
  ('sub-gerente-diurno-72', 21),
  ('sub-gerente-diurno-73', 22),
  ('sub-gerente-diurno-74', 23),
  ('sub-gerente-diurno-75', 24),
  ('sub-gerente-diurno-76', 25),
  ('sub-gerente-diurno-77', 76),
  ('sub-gerente-diurno-78', 77)
) as v(id, posicao)
where t.id = v.id;

-- sub-gerente-noturno (24 itens reordenados)
update checklist_items as t set posicao = v.posicao
from (values
  ('sub-gerente-noturno-1', 12),
  ('sub-gerente-noturno-2', 11),
  ('sub-gerente-noturno-3', 13),
  ('sub-gerente-noturno-4', 14),
  ('sub-gerente-noturno-5', 15),
  ('sub-gerente-noturno-6', 16),
  ('sub-gerente-noturno-7', 17),
  ('sub-gerente-noturno-8', 18),
  ('sub-gerente-noturno-9', 19),
  ('sub-gerente-noturno-10', 20),
  ('sub-gerente-noturno-11', 5),
  ('sub-gerente-noturno-12', 6),
  ('sub-gerente-noturno-13', 1),
  ('sub-gerente-noturno-14', 21),
  ('sub-gerente-noturno-15', 22),
  ('sub-gerente-noturno-16', 24),
  ('sub-gerente-noturno-17', 2),
  ('sub-gerente-noturno-18', 4),
  ('sub-gerente-noturno-19', 3),
  ('sub-gerente-noturno-20', 23),
  ('sub-gerente-noturno-21', 7),
  ('sub-gerente-noturno-22', 8),
  ('sub-gerente-noturno-23', 9),
  ('sub-gerente-noturno-24', 10)
) as v(id, posicao)
where t.id = v.id;

commit;
