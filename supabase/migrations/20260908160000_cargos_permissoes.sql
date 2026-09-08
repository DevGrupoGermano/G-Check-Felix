-- ============================================================================
-- G-check — cargos e permissões por funcionário
-- ----------------------------------------------------------------------------
-- Antes só havia dois papéis: 'admin' (tudo) e 'funcionario' (só executa as
-- próprias tarefas). Esta migration acrescenta um meio-termo por conta:
--
--   profiles.permissoes  text[]  -> lista de acessos concedidos individualmente
--
-- O "cargo" é derivado na interface:
--   role = 'admin'                          -> Administrador (acesso a tudo)
--   role = 'funcionario' e permissoes = {}  -> Funcionário (padrão)
--   role = 'funcionario' e permissoes <> {} -> Personalizado
--
-- Chaves de permissão reconhecidas (o catálogo canônico vive no client, em
-- src/lib/permissoes.ts):
--   cadastrar_funcionarios       -> tela Funcionários (CRUD de contas)
--   criar_checklist              -> criar/editar/excluir rotinas e itens
--   consultar_checklists_outros  -> ver todas as rotinas (só client; sem RLS)
--   marcar_checklists_outros     -> concluir/anexar/responder item de rotina
--                                    de que não é responsável (sem editar a
--                                    estrutura da checklist)
--   ver_historico                -> ler checklist_execucoes / tela Histórico
--   pausar_dias                  -> ligar/desligar dias_desativados (feriado)
--   reabrir_rotina               -> desmarcar item concluído -> pendente
--
-- Só um Administrador de verdade define cargo/permissões de uma conta: quem
-- tem apenas 'cadastrar_funcionarios' gerencia contas, mas elas ficam como
-- Funcionário padrão (garantido pela trigger profiles_guard_cargo abaixo e
-- pela server function em src/lib/employees-fn.ts).
-- ============================================================================

alter table public.profiles
  add column if not exists permissoes text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- Helper: o usuário logado é admin OU tem a permissão pedida. Espelha
-- public.is_admin() (security definer para não recursar nas policies).
-- ---------------------------------------------------------------------------
create or replace function public.tem_acesso(chave text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'admin' or chave = any (permissoes))
  );
$$;

-- ---------------------------------------------------------------------------
-- Policies: troca is_admin() pela permissão específica.
-- ---------------------------------------------------------------------------

-- checklists: escrita liberada para 'criar_checklist'
drop policy if exists "admin cria checklists" on public.checklists;
create policy "cria checklists"
  on public.checklists for insert
  to authenticated
  with check (public.tem_acesso('criar_checklist'));

drop policy if exists "admin atualiza checklists" on public.checklists;
create policy "atualiza checklists"
  on public.checklists for update
  to authenticated
  using (public.tem_acesso('criar_checklist'))
  with check (public.tem_acesso('criar_checklist'));

drop policy if exists "admin remove checklists" on public.checklists;
create policy "remove checklists"
  on public.checklists for delete
  to authenticated
  using (public.tem_acesso('criar_checklist'));

-- checklist_items: insert/delete acompanham 'criar_checklist'
drop policy if exists "admin insere itens" on public.checklist_items;
create policy "insere itens"
  on public.checklist_items for insert
  to authenticated
  with check (public.tem_acesso('criar_checklist'));

drop policy if exists "admin remove itens" on public.checklist_items;
create policy "remove itens"
  on public.checklist_items for delete
  to authenticated
  using (public.tem_acesso('criar_checklist'));

-- checklist_execucoes: leitura do histórico
drop policy if exists "admin ve execucoes" on public.checklist_execucoes;
create policy "ve execucoes"
  on public.checklist_execucoes for select
  to authenticated
  using (public.tem_acesso('ver_historico'));

-- dias_desativados: pausar/retomar o dia (feriado)
drop policy if exists "admin desativa dia" on public.dias_desativados;
create policy "desativa dia"
  on public.dias_desativados for insert
  to authenticated
  with check (public.tem_acesso('pausar_dias'));

drop policy if exists "admin reativa dia" on public.dias_desativados;
create policy "reativa dia"
  on public.dias_desativados for delete
  to authenticated
  using (public.tem_acesso('pausar_dias'));

-- profiles: ver a lista e editar contas
drop policy if exists "admin ve todos os perfis" on public.profiles;
create policy "ve todos os perfis"
  on public.profiles for select
  to authenticated
  using (public.tem_acesso('cadastrar_funcionarios'));

drop policy if exists "admin atualiza perfis" on public.profiles;
create policy "atualiza perfis"
  on public.profiles for update
  to authenticated
  using (public.tem_acesso('cadastrar_funcionarios'))
  with check (public.tem_acesso('cadastrar_funcionarios'));

-- ---------------------------------------------------------------------------
-- Anti-escalonamento: mesmo com 'cadastrar_funcionarios', um não-admin não
-- pode mexer em role/permissoes (nem se promover, nem promover outra conta).
-- A server function usa a service role key (auth.uid() nulo) e passa direto.
-- ---------------------------------------------------------------------------
create or replace function public.profiles_guard_cargo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- service role (server function que cadastra/edita funcionários)
  end if;

  if public.is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role
    or new.permissoes is distinct from old.permissoes
  then
    raise exception 'Apenas administradores podem alterar cargo e permissões.';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_cargo on public.profiles;
create trigger profiles_guard_cargo
  before update on public.profiles
  for each row execute function public.profiles_guard_cargo();

-- ---------------------------------------------------------------------------
-- Triggers de checklist_items: quem tem 'criar_checklist' edita a config dos
-- itens como um admin; 'reabrir_rotina' libera concluido -> pendente.
-- Recria as duas funções a partir da versão vigente
-- (20260908120000_responsavel_por_rotina.sql e 20260908150000_checklist_dias_pausados.sql),
-- mudando só os atalhos de permissão.
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

  -- admin ou quem pode criar/editar checklists mexe em qualquer campo
  if public.is_admin() or public.tem_acesso('criar_checklist') then
    return new;
  end if;

  -- Reabrir (concluido -> pendente) exige admin ou a permissão específica.
  if old.status = 'concluido' and new.status = 'pendente'
    and not public.tem_acesso('reabrir_rotina')
  then
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
    -- 'marcar_checklists_outros' libera marcar item de qualquer rotina, sem
    -- precisar ser o responsável (mas continua sem poder editar a estrutura
    -- da checklist — bloqueado no if acima — nem reabrir sem 'reabrir_rotina').
    if not public.tem_acesso('marcar_checklists_outros') then
      select nome into meu_nome from public.profiles where id = auth.uid();
      select responsavel into resp_rotina from public.checklists where id = old.checklist_id;

      if meu_nome is null or lower(trim(meu_nome)) is distinct from lower(trim(resp_rotina)) then
        raise exception 'Você só pode marcar itens atribuídos a você.';
      end if;
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

create or replace function public.checklist_items_block_on_disabled_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rotina_pausada_hoje boolean;
begin
  if coalesce(current_setting('app.bypass_item_guard', true), '') = 'on' then
    return new;
  end if;

  -- admin ou quem pode criar/editar checklists edita a config em qualquer dia
  if public.is_admin() or public.tem_acesso('criar_checklist') then
    return new;
  end if;

  if exists (select 1 from public.dias_desativados where data = current_date) then
    raise exception 'As rotinas de hoje estão desativadas. Fale com o administrador.';
  end if;

  select current_date = any(dias_pausados) into rotina_pausada_hoje
    from public.checklists where id = new.checklist_id;
  if coalesce(rotina_pausada_hoje, false) then
    raise exception 'Esta rotina está de folga hoje.';
  end if;

  if not public.item_roda_no_dia(new.recorrencia, new.dias_semana, new.inicio, current_date) then
    raise exception 'Esta atividade não está programada para hoje.';
  end if;

  return new;
end;
$$;
