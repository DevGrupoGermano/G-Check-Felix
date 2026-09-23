-- ============================================================================
-- G-check — corrige rollover_snapshot_checklist (colunas removidas)
-- ----------------------------------------------------------------------------
-- 20260921120000_corte_dia_rotina_noturna.sql recriou rollover_snapshot_dia
-- como rollover_snapshot_checklist a partir de uma cópia desatualizada da
-- função — anterior a duas migrations de 20260908 que:
--   - moveram "responsavel" de checklist_items para checklists (ver
--     20260908120000_responsavel_por_rotina.sql);
--   - removeram checklists.setor e checklist_execucoes.setor (ver
--     20260908140000_remove_setores.sql).
--
-- Resultado: toda vez que rollover_pendente() precisava fechar o dia
-- operacional de QUALQUER rotina, a chamada a rollover_snapshot_checklist()
-- estourava "column c.setor does not exist" (e, corrigido esse, cairia em
-- "column ci.responsavel does not exist" logo em seguida) — a exceção
-- interrompia rollover_pendente() inteira, então NENHUMA rotina jamais
-- resetava pro dia seguinte: tarefas concluídas ficavam presas indefinidamente
-- como se fossem "de ontem".
--
-- Esta migration só recria a função com as colunas certas — mesma lógica,
-- sem setor e com c.responsavel no lugar de ci.responsavel.
-- ============================================================================

create or replace function public.rollover_snapshot_checklist(
  alvo_checklist_id text,
  alvo date,
  usar_estado boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into checklist_execucoes
    (checklist_id, data, nome, turno, horario, total_itens, itens_concluidos, completa, itens)
  select
    c.id,
    alvo,
    c.nome,
    null,
    null,
    count(ci.id),
    case when usar_estado
      then count(ci.id) filter (where ci.status = 'concluido')
      else 0 end,
    case when usar_estado
      then (count(ci.id) > 0 and count(ci.id) = count(ci.id) filter (where ci.status = 'concluido'))
      else false end,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'titulo', ci.titulo,
          'responsavel', c.responsavel,
          'status', case when usar_estado then ci.status else 'pendente' end,
          'tipo_tarefa', ci.tipo_tarefa,
          'resposta_opcoes', ci.resposta_opcoes,
          'resposta', case when usar_estado then ci.resposta else null end,
          'justificativa', case when usar_estado then ci.justificativa else null end,
          'turno', ci.turno,
          'horario_inicio', to_char(ci.horario_inicio, 'HH24:MI'),
          'horario_termino', to_char(ci.horario_termino, 'HH24:MI'),
          'min_anexos', ci.min_anexos,
          'max_anexos', ci.max_anexos,
          'anexos', case when usar_estado then ci.anexos else '[]'::jsonb end,
          'concluido_em', case when usar_estado then ci.concluido_em else null end
        ) order by ci.posicao
      ),
      '[]'
    )
  from checklists c
  join checklist_items ci on ci.checklist_id = c.id
    and public.item_roda_no_dia(ci.recorrencia, ci.dias_semana, ci.inicio, alvo)
  where c.id = alvo_checklist_id
    and not exists (select 1 from dias_desativados dd where dd.data = alvo)
  group by c.id
  on conflict (checklist_id, data) do nothing;
end;
$$;
