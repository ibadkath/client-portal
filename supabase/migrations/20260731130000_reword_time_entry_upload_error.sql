-- Rewords the exception message from enforce_deliverable_milestone_started()
-- (20260731120000) to not imply a specific hour count -- any logged time
-- entry satisfies the rule, not "one hour" specifically. Logic unchanged.

create or replace function public.enforce_deliverable_milestone_started() returns trigger
language plpgsql set search_path = public as $$
declare
  milestone_status text;
  milestone_project_id uuid;
begin
  select status, project_id into milestone_status, milestone_project_id
  from milestones where id = new.milestone_id;

  if milestone_status = 'pending' then
    raise exception 'set this milestone to in_progress before uploading deliverables';
  end if;

  if not exists (select 1 from time_entries where project_id = milestone_project_id) then
    raise exception 'log a time entry before uploading deliverables';
  end if;

  return new;
end;
$$;
