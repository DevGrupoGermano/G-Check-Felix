-- ============================================================================
-- G-check — reordena os itens das rotinas com corte_dia pelo ciclo do turno
-- ----------------------------------------------------------------------------
-- `posicao` (usado pra ordenar os itens na tela e no formulário) foi gravado
-- pelo client ordenando por horário cru — 00:30 antes de 20:00. Numa rotina
-- que atravessa a meia-noite (corte_dia definido, ex.: "SUB Gerente Noturno")
-- isso bagunça a lista: os itens de madrugada (fim do turno) aparecem antes
-- dos itens da noite anterior (início do turno).
--
-- O client já foi corrigido pra ordenar pelo ciclo do corte a partir de agora
-- (toda vez que a rotina for salva pela tela) — ver `ordenarPorHorario` em
-- src/lib/g-check-store.tsx. Esta migration só corrige os dados já gravados,
-- pra não depender de alguém reabrir e salvar a rotina de novo.
-- ============================================================================

do $$
begin
  perform set_config('app.bypass_item_guard', 'on', true);

  with ciclo as (
    select
      ci.id,
      ci.checklist_id,
      ci.horario_inicio is null as sem_horario,
      case
        when ci.horario_inicio is null then null
        else (
          (extract(hour from ci.horario_inicio)::int * 60 + extract(minute from ci.horario_inicio)::int)
          - (extract(hour from c.corte_dia)::int * 60 + extract(minute from c.corte_dia)::int)
          + 1440
        ) % 1440
      end as minuto_ciclo,
      ci.posicao as posicao_atual
    from checklist_items ci
    join checklists c on c.id = ci.checklist_id
    where c.corte_dia is not null
  ),
  nova as (
    select
      id,
      row_number() over (
        partition by checklist_id
        order by sem_horario, minuto_ciclo, posicao_atual
      ) as nova_posicao
    from ciclo
  )
  update checklist_items ci
     set posicao = nova.nova_posicao
    from nova
   where nova.id = ci.id
     and ci.posicao is distinct from nova.nova_posicao;
end;
$$;
