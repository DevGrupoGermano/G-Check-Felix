-- Bucket das fotos de comprovação das tarefas (ver 20260901120000_add_item_exige_foto).
-- Público na leitura (a URL pública é guardada em checklist_items.foto_url e
-- reexibida no histórico); escrita só para usuário autenticado — a trava de
-- "só o responsável anexa" já é feita no update de checklist_items.

insert into storage.buckets (id, name, public)
values ('checklist-fotos', 'checklist-fotos', true)
on conflict (id) do update set public = true;

drop policy if exists "checklist-fotos leitura publica" on storage.objects;
create policy "checklist-fotos leitura publica"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'checklist-fotos');

drop policy if exists "checklist-fotos upload autenticado" on storage.objects;
create policy "checklist-fotos upload autenticado"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'checklist-fotos');

drop policy if exists "checklist-fotos update autenticado" on storage.objects;
create policy "checklist-fotos update autenticado"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'checklist-fotos')
  with check (bucket_id = 'checklist-fotos');

drop policy if exists "checklist-fotos delete autenticado" on storage.objects;
create policy "checklist-fotos delete autenticado"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'checklist-fotos');
