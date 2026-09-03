-- ============================================================================
-- G-check — anexos genéricos por item + quantidade mínima
-- ----------------------------------------------------------------------------
-- Substitui o par (exige_foto boolean, foto_url text) do item de checklist por:
--
--   - min_anexos int  -> quantos anexos são obrigatórios para concluir a tarefa
--                        (0 = opcional, N >= 1 = precisa de pelo menos N).
--   - anexos jsonb     -> array de {url, tipo, nome}. Foto, vídeo ou documento.
--
-- Script idempotente: pode rodar mais de uma vez. Numa base sem itens o backfill
-- é no-op. Recria os 3 objetos que liam os campos antigos (trigger de update do
-- item + as duas funções de rollover) — texto idêntico ao de 20260902120000.
-- ============================================================================

alter table checklist_items add column if not exists min_anexos int not null default 0;
alter table checklist_items add column if not exists anexos jsonb not null default '[]'::jsonb;

-- Backfill defensivo: só roda se as colunas antigas ainda existirem.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'checklist_items' and column_name = 'exige_foto'
  ) then
    update checklist_items set min_anexos = greatest(min_anexos, 1) where exige_foto;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'checklist_items' and column_name = 'foto_url'
  ) then
    update checklist_items
      set anexos = anexos || jsonb_build_array(
        jsonb_build_object('url', foto_url, 'tipo', 'image/*', 'nome', 'foto')
      )
      where coalesce(foto_url, '') <> '' and jsonb_array_length(anexos) = 0;
  end if;
end $$;

alter table checklist_items drop column if exists exige_foto;
alter table checklist_items drop column if exists foto_url;

-- ---------------------------------------------------------------------------
-- Trigger de update do item: min_anexos é só-admin; o responsável mexe em
-- anexos (além do status); barra status -> 'concluido' com menos anexos que
-- min_anexos.
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

-- ---------------------------------------------------------------------------
-- Rollover: snapshot do dia fechado guarda min_anexos + anexos.
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

-- ---------------------------------------------------------------------------
-- Rollover: limpar anexos junto com o status ao virar o dia.
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
    set status = 'pendente', anexos = '[]'::jsonb
    where status <> 'pendente' or anexos <> '[]'::jsonb;

  update app_estado set valor = hoje_local::text, atualizado_em = now()
    where chave = 'ultimo_rollover';
end;
$$;
