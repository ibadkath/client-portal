-- Extends enforce_deliverable_milestone_started() (20260731110000, which
-- already blocks uploads to a still-pending milestone) with a second,
-- project-level precondition: at least one hour must be logged in
-- time_entries for the project before any deliverable can be uploaded to
-- it. Same enforcement point as every other upload rule -- the trigger,
-- not the UI.

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
    raise exception 'log at least one hour in time entries before uploading deliverables';
  end if;

  return new;
end;
$$;
