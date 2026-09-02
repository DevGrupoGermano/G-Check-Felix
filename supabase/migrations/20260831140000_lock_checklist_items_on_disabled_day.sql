-- Trava a marcação de itens quando o dia de hoje está desativado (feriado).
-- Enquanto current_date estiver em dias_desativados, funcionários não conseguem
-- mudar o status de nenhum item — some com a "cobrança" e evita registro de
-- execução em dia sem expediente. O admin passa (mesma regra do trigger
-- checklist_items_restrict_funcionario_update): ele pode reativar o dia.

create or replace function public.checklist_items_block_on_disabled_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if exists (select 1 from public.dias_desativados where data = current_date) then
    raise exception 'As rotinas de hoje estão desativadas. Fale com o administrador.';
  end if;

  return new;
end;
$$;

drop trigger if exists checklist_items_block_on_disabled_day on checklist_items;
create trigger checklist_items_block_on_disabled_day
  before update on checklist_items
  for each row execute function public.checklist_items_block_on_disabled_day();
