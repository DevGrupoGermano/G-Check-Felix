-- ============================================================================
-- G-check — recorrência por atividade (item), não mais por rotina
-- ----------------------------------------------------------------------------
-- Antes: `checklists.dias_semana` definia os dias de toda a rotina.
-- Agora cada `checklist_items` tem sua própria recorrência:
--
--   recorrencia  'semanal' | 'quinzenal' | 'mensal'
--   dias_semana  smallint[]  -> usado quando 'semanal'
--   inicio       date        -> data de começo, usada quando 'quinzenal'/'mensal'
--
-- Regra "roda na data D" (função item_roda_no_dia):
--   semanal   -> dow(D) ∈ dias_semana
--   quinzenal -> D >= inicio e (D - inicio) múltiplo de 14
--   mensal    -> D >= inicio e dia(D) = min(dia(inicio), último dia do mês de D)
--
-- Script idempotente. Numa base sem itens o backfill é no-op. Recria os objetos
-- que liam `checklists.dias_semana` — texto alinhado com 20260902120000_init.sql.
-- ============================================================================

alter table checklist_items
  add column if not exists recorrencia text not null default 'semanal'
    check (recorrencia in ('semanal', 'quinzenal', 'mensal')),
  add column if not exists dias_semana smallint[] not null default '{0,1,2,3,4,5,6}',
  add column if not exists inicio date;

-- Backfill defensivo: herda os dias da rotina (no-op numa base vazia).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'checklists' and column_name = 'dias_semana'
  ) then
    update checklist_items ci
      set dias_semana = c.dias_semana
      from checklists c
      where c.id = ci.checklist_id;
  end if;
end $$;

alter table checklists drop column if exists dias_semana;

-- ---------------------------------------------------------------------------
-- Regra de recorrência, compartilhada pelo rollover e pelos triggers.
-- ---------------------------------------------------------------------------
create or replace function public.item_roda_no_dia(
  p_recorrencia text,
  p_dias_semana smallint[],
  p_inicio date,
  p_alvo date
) returns boolean
language sql
immutable
as $$
  select case p_recorrencia
    when 'semanal' then
      extract(dow from p_alvo)::int = any (coalesce(p_dias_semana, '{}'::smallint[]))
    when 'quinzenal' then
      p_inicio is not null and p_alvo >= p_inicio and ((p_alvo - p_inicio) % 14) = 0
    when 'mensal' then
      p_inicio is not null and p_alvo >= p_inicio
      and extract(day from p_alvo)::int = least(
        extract(day from p_inicio)::int,
        extract(day from (date_trunc('month', p_alvo) + interval '1 month' - interval '1 day'))::int
      )
    else false
  end
$$;

-- ---------------------------------------------------------------------------
-- Snapshot do dia fechado: agrega só as atividades cuja recorrência cai no dia.
-- Rotina sem nenhuma atividade no dia -> nenhuma linha de snapshot.
-- ---------------------------------------------------------------------------
create or replace function public.rollover_snapshot_dia(alvo date, usar_estado boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into checklist_execucoes
    (checklist_id, data, nome, setor, turno, horario, total_itens, itens_concluidos, completa, itens)
  select
    c.id,
    alvo,
    c.nome,
    c.setor,
    c.turno,
    c.horario,
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
          'responsavel', ci.responsavel,
          'status', case when usar_estado then ci.status else 'pendente' end,
          'min_anexos', ci.min_anexos,
          'anexos', case when usar_estado then ci.anexos else '[]'::jsonb end
        ) order by ci.posicao
      ),
      '[]'
    )
  from checklists c
  join checklist_items ci on ci.checklist_id = c.id
    and public.item_roda_no_dia(ci.recorrencia, ci.dias_semana, ci.inicio, alvo)
  where c.ativo
    and not exists (select 1 from dias_desativados dd where dd.data = alvo)
  group by c.id
  on conflict (checklist_id, data) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bloqueio "atividade fora do dia": o funcionário não mexe no status/anexos de
-- uma atividade cuja recorrência não cai em hoje. Admin e rollover passam.
-- ---------------------------------------------------------------------------
create or replace function public.checklist_items_block_on_disabled_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.bypass_item_guard', true), '') = 'on' then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  if exists (select 1 from public.dias_desativados where data = current_date) then
    raise exception 'As rotinas de hoje estão desativadas. Fale com o administrador.';
  end if;

  if not public.item_roda_no_dia(new.recorrencia, new.dias_semana, new.inicio, current_date) then
    raise exception 'Esta atividade não está programada para hoje.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Campos só-admin do item: agora incluem recorrencia / dias_semana / inicio.
-- ---------------------------------------------------------------------------
create or replace function public.checklist_items_restrict_funcionario_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meu_nome text;
begin
  -- rollover diário (rollover_pendente) reinicia status/anexos em massa
  if coalesce(current_setting('app.bypass_item_guard', true), '') = 'on' then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  if new.titulo is distinct from old.titulo
    or new.detalhe is distinct from old.detalhe
    or new.responsavel is distinct from old.responsavel
    or new.posicao is distinct from old.posicao
    or new.checklist_id is distinct from old.checklist_id
    or new.min_anexos is distinct from old.min_anexos
    or new.recorrencia is distinct from old.recorrencia
    or new.dias_semana is distinct from old.dias_semana
    or new.inicio is distinct from old.inicio
  then
    raise exception 'Apenas administradores podem editar os itens da checklist.';
  end if;

  if new.status is distinct from old.status or new.anexos is distinct from old.anexos then
    select nome into meu_nome from public.profiles where id = auth.uid();

    if meu_nome is null or lower(trim(meu_nome)) is distinct from lower(trim(old.responsavel)) then
      raise exception 'Você só pode marcar itens atribuídos a você.';
    end if;
  end if;

  if new.status = 'concluido'
    and new.status is distinct from old.status
    and coalesce(jsonb_array_length(new.anexos), 0) < new.min_anexos
  then
    raise exception 'Anexe pelo menos % arquivo(s) para concluir esta tarefa.', new.min_anexos;
  end if;

  return new;
end;
$$;
