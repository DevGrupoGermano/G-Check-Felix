-- Reforça no banco a regra "rotina desativada quando não é o dia dela": além do
-- dia pausado (dias_desativados), um funcionário não pode mexer no status de um
-- item cuja checklist não está programada para o dia da semana de hoje
-- (checklists.dias_semana). Admin passa; o rollover diário passa pelo GUC.

create or replace function public.checklist_items_block_on_disabled_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dias smallint[];
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

  select dias_semana into dias from public.checklists where id = new.checklist_id;
  if dias is not null and not (extract(dow from current_date)::int = any (dias)) then
    raise exception 'Esta rotina não está programada para hoje.';
  end if;

  return new;
end;
$$;
