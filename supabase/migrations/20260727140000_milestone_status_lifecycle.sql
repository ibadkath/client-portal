-- Expand the milestone status lifecycle from
-- ('pending', 'in_review', 'approved', 'rejected') to
-- ('pending', 'in_progress', 'completed', 'approved', 'rejected'):
-- work not started -> underway -> done and awaiting client review ->
-- client approves or rejects.

-- Drop the existing status CHECK constraint. It's unnamed in the original
-- `create table` (inline check), so Postgres auto-named it -- found
-- dynamically here rather than assumed, in case that name ever changes.
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.milestones'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table milestones drop constraint %I', con.conname);
  end loop;
end $$;

-- Migrate any existing 'in_review' rows before the new constraint goes on --
-- 'in_review' meant "done, waiting on the client," which is now 'completed'.
update milestones set status = 'completed' where status = 'in_review';

alter table milestones
  add constraint milestones_status_check
  check (status in ('pending', 'in_progress', 'completed', 'approved', 'rejected'));

-- Employees may progress a milestone through pending -> in_progress ->
-- completed; only a client may set approved/rejected (unchanged from
-- before -- this also re-establishes that split as a committed migration).
create or replace function public.enforce_milestone_client_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if is_admin() then
    if new.status is distinct from old.status and new.status not in ('pending', 'in_progress', 'completed') then
      raise exception 'employees may only set a milestone to pending, in_progress, or completed; approval/rejection is a client action';
    end if;
  else
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
