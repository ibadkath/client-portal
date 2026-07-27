-- Closes the gap confirmed by direct testing: enforce_milestone_client_update()
-- and generate_invoice_on_milestone_approval() were both wired to `update`
-- only. An admin could insert a brand-new milestone with status already set
-- to 'approved' -- bypassing the employee pending/in_progress/completed
-- restriction entirely, and producing no invoice at all (since the invoice
-- trigger never saw an update). Both triggers now also cover `insert`.
--
-- Service-role / direct-SQL callers (auth.uid() is null -- no end-user JWT
-- session, e.g. seed scripts, migrations, admin API usage) are exempted from
-- the role-based status restriction entirely, the same way they already
-- bypass RLS -- otherwise a service-role insert with the schema's own
-- default status ('pending') would get misread as a client action and
-- rejected.

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
  end if;

  return new;
end;
$$;

drop trigger if exists milestones_enforce_client_update on milestones;
create trigger milestones_enforce_client_update
  before insert or update on milestones
  for each row execute function enforce_milestone_client_update();

create or replace function public.generate_invoice_on_milestone_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    insert into invoices (project_id, milestone_id, org_id, amount_cents, status)
    values (new.project_id, new.id, new.org_id, 0, 'draft')
    on conflict (milestone_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists milestones_generate_invoice_on_approval on milestones;
create trigger milestones_generate_invoice_on_approval
  after insert or update of status on milestones
  for each row execute function generate_invoice_on_milestone_approval();
