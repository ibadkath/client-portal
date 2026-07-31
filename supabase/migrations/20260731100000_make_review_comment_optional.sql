-- enforce_milestone_client_update() (20260729130000) required a client to
-- leave a comment on a deliverable before approving/rejecting a milestone,
-- on top of the download-every-deliverable check. Product direction: a
-- comment is optional feedback, not a precondition for approval -- only the
-- "did you actually look at the work" check (download requirement) stays.

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
  end if;

  return new;
end;
$$;
