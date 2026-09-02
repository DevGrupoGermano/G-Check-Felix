-- Histórico de rotinas + reset diário automático.
--
-- Todo dia à meia-noite (fuso America/Sao_Paulo) as checklists "viram o dia":
--   1. o estado do dia que acabou é congelado em checklist_execucoes;
--   2. checklist_items volta tudo para 'pendente'.
--
-- Quem dispara: um job do pg_cron (caminho normal) e, como rede de segurança,
-- o próprio client chamando rollover_pendente() ao abrir o app. A função é
-- idempotente (trava por advisory lock + marca app_estado.ultimo_rollover), então
-- rodar de novo no mesmo dia não faz nada.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists app_estado (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now()
);

create table if not exists checklist_execucoes (
  id uuid primary key default gen_random_uuid(),
  -- sem FK para checklists: o registro sobrevive à exclusão da rotina
  checklist_id text not null,
  data date not null,
  nome text not null,
  setor text not null,
  turno text not null,
  horario time not null,
  total_itens integer not null default 0,
  itens_concluidos integer not null default 0,
  completa boolean not null default false,
  itens jsonb not null default '[]',
  registrado_em timestamptz not null default now(),
  unique (checklist_id, data)
);

create index if not exists checklist_execucoes_data_idx on checklist_execucoes (data);

alter table app_estado enable row level security;
alter table checklist_execucoes enable row level security;

-- app_estado é interno (só as funções security definer mexem) — sem policy.
drop policy if exists "autenticados veem execucoes" on checklist_execucoes;
create policy "autenticados veem execucoes"
  on checklist_execucoes for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Bypass das travas de item durante o rollover
-- ---------------------------------------------------------------------------
-- O reset mexe no status de itens de todo mundo, o que os triggers
-- checklist_items_restrict_funcionario_update e checklist_items_block_on_disabled_day
-- barrariam. rollover_pendente() liga o GUC app.bypass_item_guard (escopo da
-- transação) e os triggers respeitam. Clientes via PostgREST não conseguem
-- chamar set_config, então não há como forjar esse bypass pela aplicação.

create or replace function public.checklist_items_restrict_funcionario_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meu_nome text;
begin
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
  then
    raise exception 'Apenas administradores podem editar os itens da checklist.';
  end if;

  if new.status is distinct from old.status then
    select nome into meu_nome from public.profiles where id = auth.uid();

    if meu_nome is null or lower(trim(meu_nome)) is distinct from lower(trim(old.responsavel)) then
      raise exception 'Você só pode marcar itens atribuídos a você.';
    end if;
  end if;

  return new;
end;
$$;

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

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rollover
-- ---------------------------------------------------------------------------
-- Congela um dia em checklist_execucoes. "usar_estado" = usar o status atual dos
-- itens (dia normal, fechado no dia seguinte); false = dia sem execução (buraco
-- de vários dias sem rollover) -> registra como não realizado.
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
          'status', case when usar_estado then ci.status else 'pendente' end
        ) order by ci.posicao
      ) filter (where ci.id is not null),
      '[]'
    )
  from checklists c
  left join checklist_items ci on ci.checklist_id = c.id
  where c.ativo
    and extract(dow from alvo)::int = any (c.dias_semana)
    and not exists (select 1 from dias_desativados dd where dd.data = alvo)
  group by c.id
  on conflict (checklist_id, data) do nothing;
end;
$$;

create or replace function public.rollover_pendente()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tz constant text := 'America/Sao_Paulo';
  hoje_local date := (now() at time zone tz)::date;
  ultimo date;
  d date;
begin
  -- serializa chamadas concorrentes (vários clients abrindo o app à meia-noite)
  perform pg_advisory_xact_lock(hashtext('rollover_checklists'));

  select valor::date into ultimo from app_estado where chave = 'ultimo_rollover';

  if ultimo is null then
    -- primeira execução: nada a fechar ainda, só marca o ponto de partida
    insert into app_estado (chave, valor) values ('ultimo_rollover', hoje_local::text)
      on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
    return;
  end if;

  if ultimo >= hoje_local then
    return; -- já virou o dia hoje
  end if;

  -- fecha o último dia ativo com o estado real dos itens...
  perform public.rollover_snapshot_dia(ultimo, true);
  -- ...e eventuais dias no meio (app ficou dias sem abrir e sem cron) como não realizados
  d := ultimo + 1;
  while d < hoje_local loop
    perform public.rollover_snapshot_dia(d, false);
    d := d + 1;
  end loop;

  -- reinicia os itens para o novo dia (bypass das travas — ver comentário acima)
  perform set_config('app.bypass_item_guard', 'on', true);
  update checklist_items set status = 'pendente' where status <> 'pendente';

  update app_estado set valor = hoje_local::text, atualizado_em = now()
    where chave = 'ultimo_rollover';
end;
$$;

grant execute on function public.rollover_pendente() to authenticated;

-- ---------------------------------------------------------------------------
-- Agendamento (pg_cron) — best effort
-- ---------------------------------------------------------------------------
-- 03h05 UTC ~= 00h05 America/Sao_Paulo (Brasil sem horário de verão, UTC-3). Se
-- o pg_cron não estiver disponível no projeto, o fallback do client cobre.
do $$
begin
  execute 'create extension if not exists pg_cron';
  perform cron.schedule(
    'rollover-checklists-diario',
    '5 3 * * *',
    'select public.rollover_pendente()'
  );
exception when others then
  raise notice 'pg_cron nao configurado (%). Reset diario via fallback do client.', sqlerrm;
end;
$$;
