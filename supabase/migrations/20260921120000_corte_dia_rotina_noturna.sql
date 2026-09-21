-- ============================================================================
-- G-check — corte de dia por rotina (turnos que atravessam a meia-noite)
-- ----------------------------------------------------------------------------
-- Problema: rollover_pendente() fecha/reseta TODAS as rotinas de uma vez à
-- meia-noite local, e checklist_items_block_on_disabled_day() trava edição
-- pelo dia da semana de `current_date`. Isso funciona para rotinas do dia,
-- mas quebra rotinas noturnas que atravessam a virada (ex.: "SUB Gerente
-- Noturno", com itens de 20:00 até 07:30 do dia seguinte — ver
-- 20260905130000_seed_checklists_felix.sql): o progresso da madrugada é
-- resetado no meio do turno e itens com dias_semana restrito ficam
-- bloqueados assim que o dia da semana vira.
--
-- Solução: `checklists.corte_dia` (nullable). Quando definido (ex.: 08:00),
-- o "dia operacional" da rotina só vira depois desse horário — antes dele,
-- ainda é o dia em que o turno começou. Sem corte_dia (a maioria das
-- rotinas), nada muda: o dia operacional continua sendo a meia-noite local.
--
-- O controle de "já fechei esse dia" deixa de ser global (app_estado.
-- ultimo_rollover) e passa a ser por rotina (checklists.ultimo_rollover_dia),
-- já que cada uma pode ter seu próprio horário de corte.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colunas novas
-- ---------------------------------------------------------------------------
alter table checklists
  add column if not exists corte_dia time,
  add column if not exists ultimo_rollover_dia date;

comment on column checklists.corte_dia is
  'Hora (madrugada) em que o "dia" desta rotina vira. Null = comportamento padrão (vira à meia-noite). Definido (ex.: 06:00) = turno que atravessa a meia-noite (ex.: 23:00-06:00): antes desse horário os itens ainda contam como do dia em que o turno começou, sem resetar nem travar.';
comment on column checklists.ultimo_rollover_dia is
  'Último "dia operacional" (ver corte_dia) já fechado/resetado desta rotina. Controle interno do rollover — não editar manualmente.';

-- Migra o marco global antigo para cada rotina, pra não duplicar snapshot nem
-- forçar um reset extra na primeira execução pós-deploy.
update checklists c
  set ultimo_rollover_dia = (select valor::date from app_estado where chave = 'ultimo_rollover')
  where c.ultimo_rollover_dia is null
    and exists (select 1 from app_estado where chave = 'ultimo_rollover');

-- Único caso real hoje com itens depois da meia-noite (00:30-07:30) — as
-- outras rotinas "-noturno" do seed não passam das 21:30, não precisam de
-- corte. Admin pode ajustar/definir outras pela tela de edição da rotina.
update checklists set corte_dia = '08:00'
  where id = 'sub-gerente-noturno' and corte_dia is null;

-- ---------------------------------------------------------------------------
-- 2. Dia operacional de uma rotina, dado seu corte_dia (ou null)
-- ---------------------------------------------------------------------------
create or replace function public.dia_operacional_checklist(corte time)
returns date
language sql
stable
as $$
  select case
    when corte is null then (now() at time zone 'America/Sao_Paulo')::date
    when (now() at time zone 'America/Sao_Paulo')::time < corte
      then (now() at time zone 'America/Sao_Paulo')::date - 1
    else (now() at time zone 'America/Sao_Paulo')::date
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Snapshot do dia fechado de UMA rotina (era rollover_snapshot_dia, global
--    para todas as rotinas de uma vez — agora escopado por checklist_id, já
--    que cada rotina fecha o dia num momento diferente).
-- ---------------------------------------------------------------------------
drop function if exists public.rollover_snapshot_dia(date, boolean);

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
    (checklist_id, data, nome, setor, turno, horario, total_itens, itens_concluidos, completa, itens)
  select
    c.id,
    alvo,
    c.nome,
    c.setor,
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
          'responsavel', ci.responsavel,
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
          'anexos', case when usar_estado then ci.anexos else '[]'::jsonb end
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

-- ---------------------------------------------------------------------------
-- 4. Rollover diário — agora por rotina, cada uma no seu dia operacional.
-- ---------------------------------------------------------------------------
create or replace function public.rollover_pendente()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  dia_op date;
  d date;
begin
  -- serializa chamadas concorrentes (vários clients abrindo o app ao mesmo tempo)
  perform pg_advisory_xact_lock(hashtext('rollover_checklists'));
  perform set_config('app.bypass_item_guard', 'on', true);

  for c in select id, corte_dia, ultimo_rollover_dia from checklists where ativo loop
    dia_op := public.dia_operacional_checklist(c.corte_dia);

    if c.ultimo_rollover_dia is null then
      -- primeira execução desta rotina: nada a fechar ainda, só marca o ponto de partida
      update checklists set ultimo_rollover_dia = dia_op where id = c.id;
      continue;
    end if;

    if c.ultimo_rollover_dia >= dia_op then
      continue; -- ainda no mesmo dia operacional dessa rotina (turno em andamento)
    end if;

    -- fecha o último dia ativo dela com o estado real dos itens...
    perform public.rollover_snapshot_checklist(c.id, c.ultimo_rollover_dia, true);
    -- ...e eventuais dias no meio (ninguém abriu o app e o cron ficou fora do ar)
    d := c.ultimo_rollover_dia + 1;
    while d < dia_op loop
      perform public.rollover_snapshot_checklist(c.id, d, false);
      d := d + 1;
    end loop;

    update checklist_items ci
       set status = 'pendente', anexos = '[]'::jsonb, resposta = null, justificativa = null
     where ci.checklist_id = c.id
       and (ci.status <> 'pendente'
            or ci.anexos <> '[]'::jsonb
            or ci.resposta is not null
            or ci.justificativa is not null);

    update checklists set ultimo_rollover_dia = dia_op where id = c.id;
  end loop;
end;
$$;

grant execute on function public.rollover_pendente() to authenticated;

-- Precisa rodar perto do horário de corte de cada rotina, não só à meia-noite.
do $$
begin
  execute 'create extension if not exists pg_cron';
  perform cron.schedule(
    'rollover-checklists-diario',
    '*/5 * * * *',
    'select public.rollover_pendente()'
  );
exception when others then
  raise notice 'pg_cron nao configurado (%). Reset diario via fallback do client.', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Trigger de bloqueio por dia — usa o dia operacional da rotina do item,
--    não mais current_date cru.
-- ---------------------------------------------------------------------------
create or replace function public.checklist_items_block_on_disabled_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rotina record;
  dia_op date;
begin
  if coalesce(current_setting('app.bypass_item_guard', true), '') = 'on' then
    return new;
  end if;

  -- admin ou quem pode criar/editar checklists edita a config em qualquer dia
  if public.is_admin() or public.tem_acesso('criar_checklist') then
    return new;
  end if;

  select corte_dia, dias_pausados into rotina from public.checklists where id = new.checklist_id;
  dia_op := public.dia_operacional_checklist(rotina.corte_dia);

  if exists (select 1 from public.dias_desativados where data = dia_op) then
    raise exception 'As rotinas de hoje estão desativadas. Fale com o administrador.';
  end if;

  if dia_op = any(rotina.dias_pausados) then
    raise exception 'Esta rotina está de folga hoje.';
  end if;

  if not public.item_roda_no_dia(new.recorrencia, new.dias_semana, new.inicio, dia_op) then
    raise exception 'Esta atividade não está programada para hoje.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Reabertura automática — mesmo ajuste: dia operacional por rotina.
-- ---------------------------------------------------------------------------
create or replace function public.reabrir_automaticas()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  dia_op date;
begin
  perform pg_advisory_xact_lock(hashtext('reabrir_automaticas'));
  perform set_config('app.bypass_item_guard', 'on', true);

  for c in
    select id, corte_dia, reabre_intervalo_min, reaberta_em
      from checklists
     where ativo
       and reabre_automatico
       and reabre_intervalo_min is not null
  loop
    dia_op := public.dia_operacional_checklist(c.corte_dia);

    -- Feriado / dia sem expediente (no dia operacional dessa rotina): não reabre.
    if exists (select 1 from dias_desativados where data = dia_op) then
      continue;
    end if;

    if c.reaberta_em is not null
       and now() - c.reaberta_em < make_interval(mins => c.reabre_intervalo_min)
    then
      continue;
    end if;

    update checklist_items ci
       set status = 'pendente', anexos = '[]'::jsonb, resposta = null, justificativa = null
     where ci.checklist_id = c.id
       and public.item_roda_no_dia(ci.recorrencia, ci.dias_semana, ci.inicio, dia_op)
       and (ci.status <> 'pendente'
            or ci.anexos <> '[]'::jsonb
            or ci.resposta is not null
            or ci.justificativa is not null);

    update checklists set reaberta_em = now() where id = c.id;
  end loop;
end;
$$;

grant execute on function public.reabrir_automaticas() to authenticated;
