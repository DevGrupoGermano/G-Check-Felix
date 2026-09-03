-- ============================================================================
-- G-check — tipo de tarefa (checklist | enquete) + turno/horário por item
-- ----------------------------------------------------------------------------
-- 1. checklist_items ganha:
--      tipo_tarefa      'checklist' | 'enquete'
--      resposta_opcoes  jsonb  -> opções da enquete, ex.: ["SIM","NÃO"]
--      resposta         text   -> opção escolhida na execução (zera no rollover)
--      justificativa    text   -> motivo/observação da execução (zera no rollover)
--      turno            'Manhã' | 'Tarde' | 'Noite'  -> por item, não por rotina
--      horario_inicio   time
--      horario_termino  time
--      max_anexos       int    -> null = sem teto; bloqueia passar do limite
--
-- 2. checklists PERDE `turno` e `horario`. A rotina só "descreve" de quais
--    turnos participa e a faixa de horário (primeiro início / último término) —
--    tudo calculado no client a partir dos itens, nada gravado na rotina.
--
-- 3. Recria rollover_pendente / rollover_snapshot_dia / o trigger de update do
--    item para cobrir os campos novos. checklist_execucoes.turno/horario viram
--    nullable — o snapshot passa a guardar turno/horário POR ITEM (no jsonb).
--
-- Script idempotente. Numa base sem checklists o efeito é só estrutural.
-- Texto das funções alinhado com 20260902120000_init.sql / 20260903130000 /
-- 20260904120000.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colunas novas do item
-- ---------------------------------------------------------------------------
alter table checklist_items
  add column if not exists tipo_tarefa text not null default 'checklist'
    check (tipo_tarefa in ('checklist', 'enquete')),
  add column if not exists resposta_opcoes jsonb not null default '[]'::jsonb,
  add column if not exists resposta text,
  add column if not exists justificativa text,
  add column if not exists turno text
    check (turno is null or turno in ('Manhã', 'Tarde', 'Noite')),
  add column if not exists horario_inicio time,
  add column if not exists horario_termino time,
  add column if not exists max_anexos int
    check (max_anexos is null or max_anexos >= 0);

-- max_anexos, quando definido, não pode ser menor que min_anexos.
alter table checklist_items drop constraint if exists checklist_items_anexos_min_max;
alter table checklist_items
  add constraint checklist_items_anexos_min_max
  check (max_anexos is null or max_anexos >= min_anexos);

-- ---------------------------------------------------------------------------
-- 2. Rotina não guarda mais turno/horário
-- ---------------------------------------------------------------------------
alter table checklists drop column if exists turno;
alter table checklists drop column if exists horario;

-- Snapshot histórico: turno/horário agora vêm por item (no jsonb `itens`).
alter table checklist_execucoes alter column turno drop not null;
alter table checklist_execucoes alter column horario drop not null;

-- ---------------------------------------------------------------------------
-- 3a. Snapshot do dia fechado: sem turno/horário na rotina; guarda os campos
--     novos por item.
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
  where c.ativo
    and not exists (select 1 from dias_desativados dd where dd.data = alvo)
  group by c.id
  on conflict (checklist_id, data) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3b. Rollover diário: zera resposta/justificativa junto com status/anexos.
-- ---------------------------------------------------------------------------
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
  perform pg_advisory_xact_lock(hashtext('rollover_checklists'));

  select valor::date into ultimo from app_estado where chave = 'ultimo_rollover';

  if ultimo is null then
    insert into app_estado (chave, valor) values ('ultimo_rollover', hoje_local::text)
      on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
    return;
  end if;

  if ultimo >= hoje_local then
    return;
  end if;

  perform public.rollover_snapshot_dia(ultimo, true);
  d := ultimo + 1;
  while d < hoje_local loop
    perform public.rollover_snapshot_dia(d, false);
    d := d + 1;
  end loop;

  perform set_config('app.bypass_item_guard', 'on', true);
  update checklist_items
    set status = 'pendente', anexos = '[]'::jsonb, resposta = null, justificativa = null
    where status <> 'pendente'
       or anexos <> '[]'::jsonb
       or resposta is not null
       or justificativa is not null;

  update app_estado set valor = hoje_local::text, atualizado_em = now()
    where chave = 'ultimo_rollover';
end;
$$;

grant execute on function public.rollover_pendente() to authenticated;

-- ---------------------------------------------------------------------------
-- 3c. Trigger de update do item
--     - config da tarefa (inclui tipo_tarefa / resposta_opcoes / turno /
--       horario_inicio / horario_termino / max_anexos): só admin;
--     - execução (status / anexos / resposta / justificativa): só o responsável;
--     - max_anexos: nunca passa do teto;
--     - conclusão: exige o mínimo de anexos e, na enquete, uma resposta.
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
  -- rollover diário (rollover_pendente) reinicia status/anexos/resposta em massa
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
    or new.max_anexos is distinct from old.max_anexos
    or new.recorrencia is distinct from old.recorrencia
    or new.dias_semana is distinct from old.dias_semana
    or new.inicio is distinct from old.inicio
    or new.tipo_tarefa is distinct from old.tipo_tarefa
    or new.resposta_opcoes is distinct from old.resposta_opcoes
    or new.turno is distinct from old.turno
    or new.horario_inicio is distinct from old.horario_inicio
    or new.horario_termino is distinct from old.horario_termino
  then
    raise exception 'Apenas administradores podem editar os itens da checklist.';
  end if;

  if new.status is distinct from old.status
    or new.anexos is distinct from old.anexos
    or new.resposta is distinct from old.resposta
    or new.justificativa is distinct from old.justificativa
  then
    select nome into meu_nome from public.profiles where id = auth.uid();

    if meu_nome is null or lower(trim(meu_nome)) is distinct from lower(trim(old.responsavel)) then
      raise exception 'Você só pode marcar itens atribuídos a você.';
    end if;
  end if;

  if new.max_anexos is not null
    and coalesce(jsonb_array_length(new.anexos), 0) > new.max_anexos
  then
    raise exception 'Envie no máximo % arquivo(s) neste item.', new.max_anexos;
  end if;

  if new.status = 'concluido' and new.status is distinct from old.status then
    if coalesce(jsonb_array_length(new.anexos), 0) < new.min_anexos then
      raise exception 'Anexe pelo menos % arquivo(s) para concluir esta tarefa.', new.min_anexos;
    end if;
    if new.tipo_tarefa = 'enquete' and coalesce(btrim(new.resposta), '') = '' then
      raise exception 'Escolha uma resposta para concluir esta enquete.';
    end if;
  end if;

  return new;
end;
$$;
