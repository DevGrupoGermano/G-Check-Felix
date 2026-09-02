-- "Exigir foto": por item da checklist, o admin pode marcar que a tarefa só pode
-- ser concluída depois de anexar uma foto de comprovação.
--
--   - exige_foto  -> config da tarefa (só admin altera, como titulo/responsavel);
--   - foto_url    -> URL pública da foto anexada no dia. O responsável pelo item
--                    anexa/remove; o rollover diário limpa junto com o status.
--
-- A trava de conclusão é reforçada aqui no banco (trigger) além do client.

alter table checklist_items add column if not exists exige_foto boolean not null default false;
alter table checklist_items add column if not exists foto_url text;

-- ---------------------------------------------------------------------------
-- Trigger de update: agora também
--   1. trata exige_foto como campo só-admin;
--   2. deixa o responsável mexer em foto_url (além do status);
--   3. barra status -> 'concluido' sem foto quando exige_foto está ligado.
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
  -- rollover diário (rollover_pendente) reinicia status/foto em massa
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
    or new.exige_foto is distinct from old.exige_foto
  then
    raise exception 'Apenas administradores podem editar os itens da checklist.';
  end if;

  if new.status is distinct from old.status or new.foto_url is distinct from old.foto_url then
    select nome into meu_nome from public.profiles where id = auth.uid();

    if meu_nome is null or lower(trim(meu_nome)) is distinct from lower(trim(old.responsavel)) then
      raise exception 'Você só pode marcar itens atribuídos a você.';
    end if;
  end if;

  if new.status = 'concluido'
    and new.status is distinct from old.status
    and new.exige_foto
    and coalesce(new.foto_url, '') = ''
  then
    raise exception 'Anexe uma foto para concluir esta tarefa.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rollover: limpar foto_url junto com o status ao virar o dia, e guardar a
-- foto no snapshot do dia fechado (checklist_execucoes.itens).
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
          'exige_foto', ci.exige_foto,
          'foto_url', case when usar_estado then ci.foto_url else null end
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
    set status = 'pendente', foto_url = null
    where status <> 'pendente' or foto_url is not null;

  update app_estado set valor = hoje_local::text, atualizado_em = now()
    where chave = 'ultimo_rollover';
end;
$$;
