-- ============================================================================
-- G-check — notificação por e-mail: rotina concluída / rotina atrasada
-- ----------------------------------------------------------------------------
-- Mesmo padrão de reabertura automática (20260905140000): uma função
-- security definer, disparada por pg_cron a cada 5 min e, como rede de
-- segurança, pelo client (GCheckProvider) no mesmo intervalo.
--
-- "Concluída"/"atrasada" usam exatamente a mesma regra da tela
-- (src/lib/g-check-store.tsx: estado()/limiteDaRotina()):
--   - total/feitos = itens da rotina cuja recorrência cai em hoje
--     (public.item_roda_no_dia);
--   - limite = tempo_limite manual, ou o maior horario_termino cadastrado
--     entre os itens da rotina;
--   - concluída  = total > 0 e feitos = total;
--   - atrasada   = não concluída, tem limite, e o horário atual já passou dele.
-- Rotina sem nenhum item hoje não entra na checagem.
--
-- checklist_notificacoes evita reenviar o mesmo e-mail no mesmo dia (1 por
-- rotina/dia/tipo) — tabela interna, sem policy (só a função, via security
-- definer, mexe nela), mesmo padrão de app_estado.
--
-- E-mail via Resend (https://resend.com/docs/api-reference/emails/send-email),
-- chamado com pg_net a partir do Postgres — sem Edge Function. Credenciais
-- (API key e remetente) ficam no Vault, não em texto puro na migration:
--
--   select vault.update_secret(id, 'sua-api-key-da-resend')
--     from vault.secrets where name = 'resend_api_key';
--   select vault.update_secret(id, 'G-Check <notificacoes@seudominio.com.br>')
--     from vault.secrets where name = 'resend_from_email';
--
-- Enquanto resend_api_key ficar no valor placeholder, notificar_rotinas()
-- não faz nada (return antecipado) — seguro rodar esta migration antes de
-- configurar a conta na Resend.
-- ============================================================================

do $$
begin
  execute 'create extension if not exists pg_net';
exception when others then
  raise notice 'pg_net indisponivel (%). Notificacao por e-mail nao vai funcionar.', sqlerrm;
end;
$$;

do $$
begin
  execute 'create extension if not exists supabase_vault';
exception when others then
  raise notice 'supabase_vault indisponivel (%). Notificacao por e-mail nao vai funcionar.', sqlerrm;
end;
$$;

-- http (pgsql-http): chamada SÍNCRONA à Resend, pra só marcar como enviado
-- quando a resposta vier 2xx de verdade (ver resend_enviar() mais abaixo).
-- Sem isso teríamos que usar pg_net "solto" (assíncrono) e nunca saber se a
-- Resend aceitou — na prática, uma falha (ex: domínio ainda não verificado)
-- ficaria marcada como "enviada" e nunca mais tentaria de novo.
do $$
begin
  execute 'create extension if not exists http with schema extensions';
exception when others then
  raise notice 'extensao http indisponivel (%). resend_enviar() vai cair no modo best-effort via pg_net.', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Segredos (placeholder até você configurar de verdade — ver instruções acima).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'resend_api_key') then
    perform vault.create_secret(
      'SUBSTITUA_PELA_SUA_API_KEY',
      'resend_api_key',
      'API key da Resend usada por notificar_rotinas() para enviar e-mail de rotina concluida/atrasada.'
    );
  end if;
  if not exists (select 1 from vault.secrets where name = 'resend_from_email') then
    perform vault.create_secret(
      'G-Check <onboarding@resend.dev>',
      'resend_from_email',
      'Remetente usado nos e-mails de notificacao (troque pelo seu dominio verificado na Resend).'
    );
  end if;
exception when others then
  raise notice 'Vault indisponivel (%). Configure resend_api_key/resend_from_email manualmente depois.', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Controle de envio (1 e-mail por rotina/dia/tipo).
-- ---------------------------------------------------------------------------
create table if not exists checklist_notificacoes (
  -- sem FK para checklists: sobrevive à exclusão da rotina, como checklist_execucoes
  checklist_id text not null,
  data date not null,
  tipo text not null check (tipo in ('concluida', 'atrasada')),
  enviado_em timestamptz not null default now(),
  primary key (checklist_id, data, tipo)
);

alter table checklist_notificacoes enable row level security;
-- Tabela interna (só notificar_rotinas() mexe nela, via security definer) — sem policy.

-- ---------------------------------------------------------------------------
-- Envio: chamada síncrona à Resend via extensão http — só retorna true (e só
-- aí notificar_rotinas() marca como enviado) quando a Resend responde 2xx de
-- verdade. Se a extensão http não estiver disponível por algum motivo, cai
-- pro pg_net "solto" (best-effort, mesmo risco de antes) em vez de travar o
-- job inteiro — assim uma rotina não deixa de notificar as outras.
-- ---------------------------------------------------------------------------
create or replace function public.resend_enviar(
  p_api_key text,
  p_from text,
  p_destinatarios text[],
  p_assunto text,
  p_html text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  corpo jsonb;
  resp http_response;
  ok boolean;
begin
  corpo := jsonb_build_object(
    'from', p_from,
    'to', to_jsonb(p_destinatarios),
    'subject', p_assunto,
    'html', p_html
  );

  begin
    select * into resp from http((
      'POST',
      'https://api.resend.com/emails',
      ARRAY[http_header('Authorization', 'Bearer ' || p_api_key)],
      'application/json',
      corpo::text
    )::http_request);
    ok := resp.status between 200 and 299;
  exception when others then
    -- extensão http indisponível/erro inesperado: dispara sem confirmação
    -- (comportamento antigo) em vez de deixar a rotina sem notificar.
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || p_api_key,
        'Content-Type', 'application/json'
      ),
      body := corpo
    );
    ok := true;
  end;

  return coalesce(ok, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Checagem + envio.
-- ---------------------------------------------------------------------------
create or replace function public.notificar_rotinas()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tz constant text := 'America/Sao_Paulo';
  hoje date := (now() at time zone tz)::date;
  agora time := (now() at time zone tz)::time;
  api_key text;
  from_email text;
  destinatarios text[];
  c record;
  assunto text;
  html text;
begin
  perform pg_advisory_xact_lock(hashtext('notificar_rotinas'));

  if exists (select 1 from dias_desativados where data = hoje) then
    return;
  end if;

  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  select decrypted_secret into from_email from vault.decrypted_secrets where name = 'resend_from_email';

  -- Ainda não configurado (placeholder da migration) — não tenta enviar.
  if api_key is null or api_key = '' or api_key = 'SUBSTITUA_PELA_SUA_API_KEY' then
    return;
  end if;

  select array_agg(email) into destinatarios
    from profiles
   where role = 'admin' and email is not null and btrim(email) <> '';
  if destinatarios is null or array_length(destinatarios, 1) = 0 then
    return;
  end if;

  for c in
    select
      ch.id,
      ch.nome,
      ch.setor,
      coalesce(ch.tempo_limite, max(ci.horario_termino)) as limite,
      count(*) filter (
        where public.item_roda_no_dia(ci.recorrencia, ci.dias_semana, ci.inicio, hoje)
      ) as total,
      count(*) filter (
        where public.item_roda_no_dia(ci.recorrencia, ci.dias_semana, ci.inicio, hoje)
          and ci.status = 'concluido'
      ) as feitos
    from checklists ch
    join checklist_items ci on ci.checklist_id = ch.id
    where ch.ativo
    group by ch.id, ch.nome, ch.setor, ch.tempo_limite
    having count(*) filter (
      where public.item_roda_no_dia(ci.recorrencia, ci.dias_semana, ci.inicio, hoje)
    ) > 0
  loop
    if c.feitos = c.total then
      if not exists (
        select 1 from checklist_notificacoes
         where checklist_id = c.id and data = hoje and tipo = 'concluida'
      ) then
        assunto := '✅ Rotina concluída: ' || c.nome;
        html := format(
          '<p>A rotina <strong>%s</strong> (%s) foi concluída hoje, %s.</p><p>%s de %s itens.</p>',
          c.nome, c.setor, to_char(hoje, 'DD/MM/YYYY'), c.feitos, c.total
        );
        if public.resend_enviar(api_key, from_email, destinatarios, assunto, html) then
          insert into checklist_notificacoes (checklist_id, data, tipo)
          values (c.id, hoje, 'concluida');
        end if;
      end if;

    elsif c.limite is not null and agora > c.limite then
      if not exists (
        select 1 from checklist_notificacoes
         where checklist_id = c.id and data = hoje and tipo = 'atrasada'
      ) then
        assunto := '⚠️ Rotina atrasada: ' || c.nome;
        html := format(
          '<p>A rotina <strong>%s</strong> (%s) está atrasada — passou do horário limite (%s) sem terminar.</p><p>%s de %s itens concluídos.</p>',
          c.nome, c.setor, to_char(c.limite, 'HH24:MI'), c.feitos, c.total
        );
        if public.resend_enviar(api_key, from_email, destinatarios, assunto, html) then
          insert into checklist_notificacoes (checklist_id, data, tipo)
          values (c.id, hoje, 'atrasada');
        end if;
      end if;
    end if;
  end loop;
end;
$$;

grant execute on function public.notificar_rotinas() to authenticated;

-- ---------------------------------------------------------------------------
-- Agendamento (pg_cron) — best effort, mesmo padrão das outras rotinas internas.
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'create extension if not exists pg_cron';
  perform cron.schedule(
    'notificar-rotinas-email',
    '*/5 * * * *',
    'select public.notificar_rotinas()'
  );
exception when others then
  raise notice 'pg_cron nao configurado (%). Notificacao via fallback do client.', sqlerrm;
end;
$$;
