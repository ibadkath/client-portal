-- Phase 2: Row Level Security. Every table gets policies; the anon key is
-- assumed to be in hostile hands at all times.

-- Helper functions ----------------------------------------------------------
-- SECURITY DEFINER so their internal lookup on `profiles` bypasses RLS
-- entirely (owner-bypass), which is what avoids the classic
-- "profiles policy selects from profiles and recurses" trap.

create or replace function public.current_org_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select role from profiles where id = auth.uid()) = 'admin', false);
$$;

-- Harden the Phase 1 org_id propagation triggers -----------------------------
-- These ran fine with RLS off (Phase 1), reading their parent row as
-- whoever was invoking them. Now that RLS is on, a plain (SECURITY INVOKER)
-- trigger's lookup would itself be filtered by RLS: a client inserting a
-- comment against a deliverable in *another* org wouldn't be able to see
-- that deliverable under RLS, so the trigger's SELECT would return nothing,
-- new.org_id would fall back to whatever the client supplied, and a
-- spoofed org_id would sail through. Marking these SECURITY DEFINER makes
-- the lookup always see the true parent, regardless of the caller's
-- visibility into it, closing that gap.

create or replace function public.set_milestone_org_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select org_id into new.org_id from projects where id = new.project_id;
  return new;
end;
$$;

create or replace function public.set_deliverable_org_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select org_id into new.org_id from milestones where id = new.milestone_id;
  return new;
end;
$$;

create or replace function public.set_comment_org_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select org_id into new.org_id from deliverables where id = new.deliverable_id;
  return new;
end;
$$;

create or replace function public.set_invoice_org_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select org_id into new.org_id from projects where id = new.project_id;
  return new;
end;
$$;

create or replace function public.set_time_entry_org_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select org_id into new.org_id from projects where id = new.project_id;
  return new;
end;
$$;

-- Comment authorship ----------------------------------------------------
-- Force author_id to the caller's own id, the same way org_id is forced --
-- never trust a client-supplied author_id.

create function public.set_comment_author_id() returns trigger
language plpgsql set search_path = public as $$
begin
  new.author_id := auth.uid();
  return new;
end;
$$;

create trigger comments_set_author_id
  before insert on comments
  for each row execute function set_comment_author_id();

-- Milestone column lock ------------------------------------------------------
-- RLS controls which ROWS a client can update; it can't restrict which
-- COLUMNS change within an allowed row. A client's UPDATE policy on
-- milestones (below) would otherwise let them rewrite title, sequence,
-- due_date, etc. This trigger is the column-level half of "milestone
-- approval is a client write, but only on the status field."

create function public.enforce_milestone_client_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if not is_admin() then
    if new.project_id is distinct from old.project_id
      or new.org_id is distinct from old.org_id
      or new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.sequence is distinct from old.sequence
      or new.due_date is distinct from old.due_date
      or new.created_at is distinct from old.created_at
    then
      raise exception 'clients may only change a milestone''s status';
    end if;

    if new.status not in ('approved', 'rejected') then
      raise exception 'clients may only approve or reject a milestone';
    end if;
  end if;

  return new;
end;
$$;

create trigger milestones_enforce_client_update
  before update on milestones
  for each row execute function enforce_milestone_client_update();

-- Enable RLS on every table --------------------------------------------------

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table projects enable row level security;
alter table milestones enable row level security;
alter table deliverables enable row level security;
alter table comments enable row level security;
alter table invoices enable row level security;
alter table time_entries enable row level security;

-- organizations ---------------------------------------------------------
-- Clients read their own org's row; admins read/write everything;
-- creating/renaming orgs is an admin-only action.

create policy organizations_select on organizations for select
  to authenticated
  using (is_admin() or id = current_org_id());

create policy organizations_insert on organizations for insert
  to authenticated
  with check (is_admin());

create policy organizations_update on organizations for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy organizations_delete on organizations for delete
  to authenticated
  using (is_admin());

-- profiles ------------------------------------------------------------------
-- A client can see their own row and their org-mates' (e.g. to resolve who
-- left a comment); admins see everyone. Creating/editing/deleting profiles
-- (role, org assignment) is admin-only -- a client can never grant
-- themselves admin or move themselves to another org.

create policy profiles_select on profiles for select
  to authenticated
  using (is_admin() or id = auth.uid() or org_id = current_org_id());

create policy profiles_insert on profiles for insert
  to authenticated
  with check (is_admin());

create policy profiles_update on profiles for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy profiles_delete on profiles for delete
  to authenticated
  using (is_admin());

-- projects ------------------------------------------------------------------

create policy projects_select on projects for select
  to authenticated
  using (is_admin() or org_id = current_org_id());

create policy projects_insert on projects for insert
  to authenticated
  with check (is_admin());

create policy projects_update on projects for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy projects_delete on projects for delete
  to authenticated
  using (is_admin());

-- milestones ------------------------------------------------------------
-- Two UPDATE policies: admins can change anything; clients can attempt an
-- update on their own org's milestones, with the trigger above enforcing
-- that only `status` (and only to approved/rejected) actually changes.

create policy milestones_select on milestones for select
  to authenticated
  using (is_admin() or org_id = current_org_id());

create policy milestones_insert on milestones for insert
  to authenticated
  with check (is_admin());

create policy milestones_update_admin on milestones for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy milestones_update_client on milestones for update
  to authenticated
  using (org_id = current_org_id())
  with check (org_id = current_org_id());

create policy milestones_delete on milestones for delete
  to authenticated
  using (is_admin());

-- deliverables ------------------------------------------------------------

create policy deliverables_select on deliverables for select
  to authenticated
  using (is_admin() or org_id = current_org_id());

create policy deliverables_insert on deliverables for insert
  to authenticated
  with check (is_admin());

create policy deliverables_update on deliverables for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy deliverables_delete on deliverables for delete
  to authenticated
  using (is_admin());

-- comments ------------------------------------------------------------------
-- Clients can insert (author_id is forced to auth.uid() by trigger, org_id
-- is forced from the deliverable by trigger); editing/deleting is admin-only.

create policy comments_select on comments for select
  to authenticated
  using (is_admin() or org_id = current_org_id());

create policy comments_insert on comments for insert
  to authenticated
  with check (is_admin() or org_id = current_org_id());

create policy comments_delete on comments for delete
  to authenticated
  using (is_admin());

-- invoices ------------------------------------------------------------------
-- Clients read their own org's invoices; they can never write invoices.

create policy invoices_select on invoices for select
  to authenticated
  using (is_admin() or org_id = current_org_id());

create policy invoices_insert on invoices for insert
  to authenticated
  with check (is_admin());

create policy invoices_update on invoices for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy invoices_delete on invoices for delete
  to authenticated
  using (is_admin());

-- time_entries ------------------------------------------------------------
-- Not part of the client view in the brief -- admin-only end to end.

create policy time_entries_select on time_entries for select
  to authenticated
  using (is_admin());

create policy time_entries_insert on time_entries for insert
  to authenticated
  with check (is_admin());

create policy time_entries_update on time_entries for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy time_entries_delete on time_entries for delete
  to authenticated
  using (is_admin());
