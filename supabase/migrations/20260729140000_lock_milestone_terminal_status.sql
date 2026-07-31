-- Confirmed live: an admin could revert an 'approved' milestone straight
-- back to 'pending' using their own status dropdown -- the previous version
-- of enforce_milestone_client_update() only checked what value a role could
-- set, never what state the milestone was already in. A milestone that had
-- already been approved (and had a draft invoice generated for it) could
-- silently un-approve with no trace and no consequence for the invoice.
--
-- 'approved' and 'rejected' are now terminal: once a milestone reaches
-- either one, no further status change is possible through the app by
-- anyone, admin included. (Direct service-role/SQL access still bypasses
-- this, same as every other rule in this trigger -- see the auth.uid() is
-- null guard below, unchanged from prior migrations.)
--
-- While in here: closes a second, related gap the same live test surfaced
-- a client could approve/reject a milestone directly from 'pending' or
-- 'in_progress' -- skipping 'completed' entirely -- as long as deliverables
-- existed and they'd downloaded/commented. A client's decision now requires
-- the milestone to actually be 'completed' first.

create or replace function public.enforce_milestone_client_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status in ('approved', 'rejected')
     and new.status is distinct from old.status
  then
    raise exception 'this milestone was already % and cannot be reopened', old.status;
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

    if tg_op = 'INSERT' or old.status is distinct from 'completed' then
      raise exception 'a milestone must be completed before a client can approve or reject it';
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
