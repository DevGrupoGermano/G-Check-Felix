-- ============================================================================
-- G-check — responsável passa a ser da ROTINA, não de cada atividade
-- ----------------------------------------------------------------------------
-- Antes, cada checklist_items tinha seu próprio "responsavel": numa rotina com
-- várias atividades o admin escolhia o funcionário responsável várias vezes —
-- sempre a mesma pessoa, na prática (toda a carga de dados do Félix confirma
-- isso, ver 20260905130000_seed_checklists_felix.sql, comentário da linha 12).
-- Isso duplicava o cadastro sem necessidade.
--
-- Agora o responsável é um campo da ROTINA (checklists.responsavel); os itens
-- não têm mais responsável próprio — todos os itens de uma checklist são
-- executados pelo mesmo funcionário, escolhido uma única vez no cadastro da
-- rotina (src/components/checklist-form-dialog.tsx).
--
-- Backfill: cada rotina herda o responsavel do seu primeiro item (por
-- posição) — não perde informação, já que todo item de uma mesma checklist
-- sempre teve o mesmo responsavel nos dados reais. Rotina sem item nenhum
-- fica com responsavel = '' (o admin completa depois, editando a rotina).
-- ============================================================================

alter table checklists add column if not exists responsavel text not null default '';

update checklists c
   set responsavel = coalesce((
     select ci.responsavel
       from checklist_items ci
      where ci.checklist_id = c.id
      order by ci.posicao
      limit 1
   ), '')
 where c.responsavel = '';

-- ---------------------------------------------------------------------------
-- Snapshot do dia fechado: "responsavel" (por item, no jsonb) passa a vir da
-- rotina (c.responsavel) em vez do item — mesmo texto salvo, fonte diferente.
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
-- Trigger de update dos itens: "responsavel" sai da lista de campos só-admin
-- do item (não existe mais nessa tabela) e a checagem "só o responsável marca
-- o status/anexo/resposta" passa a olhar checklists.responsavel da rotina do
-- item, não mais old.responsavel.
-- ---------------------------------------------------------------------------
create or replace function public.checklist_items_restrict_funcionario_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meu_nome text;
  resp_rotina text;
begin
  -- rollover diário (rollover_pendente) reinicia status/anexos/resposta em massa
  if coalesce(current_setting('app.bypass_item_guard', true), '') = 'on' then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  -- Reabrir (concluido -> pendente) é exclusivo do admin.
  if old.status = 'concluido' and new.status = 'pendente' then
    raise exception 'Apenas administradores podem reabrir uma tarefa concluída.';
  end if;

  if new.titulo is distinct from old.titulo
    or new.detalhe is distinct from old.detalhe
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
    select responsavel into resp_rotina from public.checklists where id = old.checklist_id;

    if meu_nome is null or lower(trim(meu_nome)) is distinct from lower(trim(resp_rotina)) then
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

-- ---------------------------------------------------------------------------
-- O item não guarda mais responsável próprio — a rotina inteira tem um só.
-- ---------------------------------------------------------------------------
alter table checklist_items drop column if exists responsavel;
