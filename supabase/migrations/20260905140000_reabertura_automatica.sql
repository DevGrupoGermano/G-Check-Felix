-- ============================================================================
-- G-check — reabertura automática de rotina (intra-dia)
-- ----------------------------------------------------------------------------
-- Alguns controles precisam ser refeitos várias vezes ao dia — o giro da
-- Segurança "a cada 20 minutos", por exemplo. Esta migration adiciona à rotina:
--
--   reabre_automatico    boolean  -> liga/desliga a reabertura intra-dia
--   reabre_intervalo_min integer  -> de quantos em quantos minutos ela reabre
--   reaberta_em          timestamptz -> última vez que reabriu (controle interno)
--
-- reabrir_automaticas() volta os itens da rotina para 'pendente' (limpando
-- anexos/resposta/justificativa do ciclo, como o rollover diário) quando o
-- intervalo já passou. Dispara por pg_cron (a cada minuto) e pelo fallback do
-- client. Dia pausado (dias_desativados) não reabre nada.
--
-- Não gera histórico por ciclo — o snapshot continua sendo 1 por dia, no
-- rollover. Idempotente.
-- ============================================================================

alter table checklists
  add column if not exists reabre_automatico boolean not null default false,
  add column if not exists reabre_intervalo_min integer,
  add column if not exists reaberta_em timestamptz;

alter table checklists drop constraint if exists checklists_reabre_intervalo_valido;
alter table checklists
  add constraint checklists_reabre_intervalo_valido
  check (
    not reabre_automatico
    or (reabre_intervalo_min is not null and reabre_intervalo_min between 1 and 1440)
  );

-- ---------------------------------------------------------------------------
-- Reabre as rotinas cujo intervalo já venceu. security definer + bypass do
-- guard dos itens (mesmo esquema do rollover); clientes via PostgREST não
-- conseguem forjar o GUC.
-- ---------------------------------------------------------------------------
create or replace function public.reabrir_automaticas()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tz constant text := 'America/Sao_Paulo';
  hoje date := (now() at time zone tz)::date;
  c record;
begin
  perform pg_advisory_xact_lock(hashtext('reabrir_automaticas'));

  -- Feriado / dia sem expediente: não reabre nada.
  if exists (select 1 from dias_desativados where data = hoje) then
    return;
  end if;

  perform set_config('app.bypass_item_guard', 'on', true);

  for c in
    select id, reabre_intervalo_min, reaberta_em
      from checklists
     where ativo
       and reabre_automatico
       and reabre_intervalo_min is not null
  loop
    if c.reaberta_em is not null
       and now() - c.reaberta_em < make_interval(mins => c.reabre_intervalo_min)
    then
      continue;
    end if;

    update checklist_items ci
       set status = 'pendente', anexos = '[]'::jsonb, resposta = null, justificativa = null
     where ci.checklist_id = c.id
       and public.item_roda_no_dia(ci.recorrencia, ci.dias_semana, ci.inicio, hoje)
       and (ci.status <> 'pendente'
            or ci.anexos <> '[]'::jsonb
            or ci.resposta is not null
            or ci.justificativa is not null);

    update checklists set reaberta_em = now() where id = c.id;
  end loop;
end;
$$;

grant execute on function public.reabrir_automaticas() to authenticated;

-- ---------------------------------------------------------------------------
-- Agendamento (pg_cron) — best effort, mesmo padrão do rollover diário.
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'create extension if not exists pg_cron';
  perform cron.schedule(
    'reabrir-rotinas-automaticas',
    '* * * * *',
    'select public.reabrir_automaticas()'
  );
exception when others then
  raise notice 'pg_cron nao configurado (%). Reabertura via fallback do client.', sqlerrm;
end;
$$;
