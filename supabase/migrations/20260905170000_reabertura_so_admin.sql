-- ============================================================================
-- G-check — reabrir uma tarefa concluída passa a ser exclusivo do admin
-- ----------------------------------------------------------------------------
-- Antes, o responsável por um item podia tanto concluir quanto desmarcar
-- (voltar para "pendente") a própria tarefa. Agora o funcionário só pode
-- concluir: uma vez `status = 'concluido'`, somente admin (ou o rollover
-- diário, via app.bypass_item_guard) pode voltar para "pendente".
-- ============================================================================

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

  -- Reabrir (concluido -> pendente) é exclusivo do admin daqui para baixo.
  if old.status = 'concluido' and new.status = 'pendente' then
    raise exception 'Apenas administradores podem reabrir uma tarefa concluída.';
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
