-- Closes two gaps confirmed by direct testing of the milestone lifecycle:
--   1. An admin could mark a milestone 'completed' with zero deliverables
--      uploaded -- there was nothing stopping it at any layer.
--   2. A client could 'approve' (or 'reject') a milestone without ever
--      fetching a deliverable's signed URL or leaving a comment on it --
--      the UI showed Approve/Reject as soon as status flipped to
--      'completed', and enforce_milestone_client_update() only checked
--      *which* status a client could set, never *what they'd done first*.
--
-- Both are closed the same way every other rule in this schema is closed:
-- in the trigger, not the UI. The UI changes alongside this are just
-- guidance (disable the option, explain what's missing) -- a client
-- calling the REST API directly still hits these checks.

-- deliverable_downloads -------------------------------------------------
-- An append-only audit log: one row per (deliverable, viewer) download.
-- This is what "the client reviewed the deliverable" actually cashes out
-- to -- there's no other server-observable signal for "they looked at it."
-- Multiple rows per pair are allowed (re-downloads aren't deduplicated);
-- the approval check below only cares whether at least one exists.

create table deliverable_downloads (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references deliverables (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index deliverable_downloads_deliverable_id_idx on deliverable_downloads (deliverable_id);
create index deliverable_downloads_user_id_idx on deliverable_downloads (user_id);
create index deliverable_downloads_deliverable_user_idx on deliverable_downloads (deliverable_id, user_id);

-- Same org_id-from-parent, SECURITY DEFINER pattern as every other child
-- table (set_comment_org_id, set_deliverable_org_id, ...) -- see the
-- Phase 2 migration for why SECURITY DEFINER matters here.

create function public.set_deliverable_download_org_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select org_id into new.org_id from deliverables where id = new.deliverable_id;
  return new;
end;
$$;

create trigger deliverable_downloads_set_org_id
  before insert on deliverable_downloads
  for each row execute function set_deliverable_download_org_id();

-- Same forced-identity pattern as set_comment_author_id -- never trust a
-- client-supplied user_id, or a client could log a download "on behalf of"
-- someone else to forge review evidence.

create function public.set_deliverable_download_user_id() returns trigger
language plpgsql set search_path = public as $$
begin
  new.user_id := auth.uid();
  return new;
end;
$$;

create trigger deliverable_downloads_set_user_id
  before insert on deliverable_downloads
  for each row execute function set_deliverable_download_user_id();

alter table deliverable_downloads enable row level security;

create policy deliverable_downloads_select on deliverable_downloads for select
  to authenticated
  using (is_admin() or org_id = current_org_id());

create policy deliverable_downloads_insert on deliverable_downloads for insert
  to authenticated
  with check (is_admin() or org_id = current_org_id());

-- No update/delete policy anywhere, including for admins: this is an audit
-- trail of what was actually downloaded, not an editable record.

-- Milestone lifecycle gates -----------------------------------------------
-- Extends enforce_milestone_client_update() (previously: which statuses
-- each role may set) with *preconditions* on two specific transitions:
--   - admin -> 'completed' requires at least one deliverable to exist.
--   - client -> 'approved'/'rejected' requires the client to have
--     downloaded every deliverable on the milestone AND left at least one
--     comment on one of them. Reject is held to the same bar as approve --
--     a considered "no" still requires having looked at the work; without
--     this a client could bypass the download/comment requirement entirely
--     by rejecting instead of approving, with no real difference in effort.

create or replace function public.enforce_milestone_client_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if is_admin() then
    if (tg_op = 'INSERT' or new.status is distinct from old.status)
       and new.status not in ('pending', 'in_progress', 'completed') then
      raise exception 'employees may only set a milestone to pending, in_progress, or completed; approval/rejection is a client action';
    end if;

    if new.status = 'completed'
       and (tg_op = 'INSERT' or old.status is distinct from 'completed')
       and not exists (select 1 from deliverables where milestone_id = new.id)
    then
      raise exception 'upload at least one deliverable before marking this milestone completed';
    end if;
  else
    if tg_op = 'UPDATE' and (
      new.project_id is distinct from old.project_id
      or new.org_id is distinct from old.org_id
      or new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.sequence is distinct from old.sequence
      or new.due_date is distinct from old.due_date
      or new.created_at is distinct from old.created_at
    ) then
      raise exception 'clients may only change a milestone''s status';
    end if;

    if new.status not in ('approved', 'rejected') then
      raise exception 'clients may only approve or reject a milestone';
    end if;

    if not exists (select 1 from deliverables where milestone_id = new.id) then
      raise exception 'this milestone has no deliverables to review yet';
    end if;

    if exists (
      select 1 from deliverables d
      where d.milestone_id = new.id
        and not exists (
          select 1 from deliverable_downloads dd
          where dd.deliverable_id = d.id and dd.user_id = auth.uid()
        )
    ) then
      raise exception 'download and review every deliverable before approving or rejecting this milestone';
    end if;

    if not exists (
      select 1
      from comments c
      join deliverables d on d.id = c.deliverable_id
      where d.milestone_id = new.id and c.author_id = auth.uid()
    ) then
      raise exception 'leave a comment on a deliverable before approving or rejecting this milestone';
    end if;
  end if;

  return new;
end;
$$;
