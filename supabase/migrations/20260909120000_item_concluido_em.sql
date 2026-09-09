-- ============================================================================
-- Registra QUANDO cada atividade foi concluída, pra distinguir no dia
-- seguinte "concluída no prazo" de "concluída atrasada" (hoje só existia
-- pendente/concluido — a informação de horário evaporava no rollover).
-- ----------------------------------------------------------------------------
-- concluido_em é carimbado pelo próprio banco (now()), não pelo client: evita
-- depender do relógio do celular de quem marcou e cobre qualquer caminho que
-- muda o status (toggle, concluir rotina, enquete respondida, anexo que fecha
-- o mínimo). Zera de novo ao reabrir.
-- ============================================================================

alter table checklist_items add column if not exists concluido_em timestamptz;

create or replace function public.checklist_items_stamp_concluido_em()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.concluido_em := case when new.status = 'concluido' then now() else null end;
  end if;
  return new;
end;
$$;

drop trigger if exists checklist_items_stamp_concluido_em on checklist_items;
create trigger checklist_items_stamp_concluido_em
  before update on checklist_items
  for each row execute function public.checklist_items_stamp_concluido_em();

-- ---------------------------------------------------------------------------
-- Rollover: carrega concluido_em junto no snapshot do dia fechado, senão a
-- informação se perde de novo assim que o dia vira (mesmo motivo de sempre —
-- ver 20260902120000_init.sql, seção "Rollover").
-- ---------------------------------------------------------------------------
create or replace function public.rollover_snapshot_dia(alvo date, usar_estado boolean)
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
  where c.ativo
    and not exists (select 1 from dias_desativados dd where dd.data = alvo)
    and not (alvo = any(c.dias_pausados))
  group by c.id
  on conflict (checklist_id, data) do nothing;
end;
$$;
