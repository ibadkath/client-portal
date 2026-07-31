-- Two rules tying deliverable uploads to the milestone lifecycle:
--   1. An admin can't upload to a milestone that hasn't been started yet --
--      set it to in_progress first. Enforced in the trigger, not just the
--      UI, same as every other rule in this schema.
--   2. Uploading a deliverable to an in_progress milestone advances it
--      straight to completed -- the upload *is* the "work is done" signal,
--      so there's no separate manual step. This only fires from
--      in_progress; a milestone already completed/approved/rejected is
--      untouched by further uploads.

create function public.enforce_deliverable_milestone_started() returns trigger
language plpgsql set search_path = public as $$
declare
  milestone_status text;
begin
  select status into milestone_status from milestones where id = new.milestone_id;

  if milestone_status = 'pending' then
    raise exception 'set this milestone to in_progress before uploading deliverables';
  end if;

  return new;
end;
$$;

create trigger deliverables_block_pending_milestone
  before insert on deliverables
  for each row execute function enforce_deliverable_milestone_started();

-- Runs as the uploading admin (not SECURITY DEFINER) -- milestones_update_admin
-- already grants admins UPDATE on milestones, and enforce_milestone_client_update
-- already allows admin -> 'completed', so no extra privilege is needed here.
create function public.advance_milestone_on_deliverable_upload() returns trigger
language plpgsql set search_path = public as $$
begin
  update milestones set status = 'completed'
  where id = new.milestone_id and status = 'in_progress';

  return new;
end;
$$;

create trigger deliverables_advance_milestone_status
  after insert on deliverables
  for each row execute function advance_milestone_on_deliverable_upload();
