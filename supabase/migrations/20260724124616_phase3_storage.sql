-- Phase 3: Storage. Table RLS (Phase 2) does not protect the actual files --
-- this is a separate system that needs its own policies, keyed off the
-- storage_path convention decided in Phase 1 (org_id/project_id/filename).

insert into storage.buckets (id, name, public)
values ('deliverables', 'deliverables', false)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by default on every Supabase
-- project; we only add policies scoped to this one bucket.

create policy deliverables_storage_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'deliverables'
    and (is_admin() or (storage.foldername(name))[1] = current_org_id()::text)
  );

create policy deliverables_storage_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'deliverables'
    and is_admin()
  );

create policy deliverables_storage_update on storage.objects for update
  to authenticated
  using (bucket_id = 'deliverables' and is_admin())
  with check (bucket_id = 'deliverables' and is_admin());

create policy deliverables_storage_delete on storage.objects for delete
  to authenticated
  using (bucket_id = 'deliverables' and is_admin());
