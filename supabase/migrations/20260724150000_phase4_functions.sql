-- Phase 4: server-side logic. The database starts doing work, not just
-- storing and guarding it.

-- Project progress --------------------------------------------------------
-- Percentage of a project's milestones that are approved. SECURITY INVOKER
-- (the default) is correct here, not SECURITY DEFINER: we want RLS to still
-- apply, so a client calling this for a project that isn't theirs simply
-- sees 0 milestones / 0% rather than us needing to re-check org membership
-- by hand.

create or replace function public.project_progress(p_project_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when count(*) = 0 then 0
    else round(100.0 * count(*) filter (where status = 'approved') / count(*), 2)
  end
  from milestones
  where project_id = p_project_id;
$$;

-- Signup trigger ------------------------------------------------------------
-- Fires on every new auth.users row, from any path (app, dashboard, script).
-- SECURITY DEFINER because at signup time there is no authenticated session
-- yet for the profiles RLS policies to allow the insert under.
--
-- Role and org_id come from the signup's user_metadata, not from a client
-- request body -- so this is meant to be used with pre-provisioned
-- invitations (an admin creates the user via the service role with
-- {role, org_id} already set in metadata), not an open public signup form.
-- If someone signs up as role "client" with no org_id in metadata, the
-- profiles.client_requires_org check rejects it and the whole signup fails --
-- deliberately fail-closed rather than creating an orgless client.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, org_id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'role', 'client'),
    (new.raw_user_meta_data ->> 'org_id')::uuid,
    new.raw_user_meta_data ->> 'full_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Invoice generation on project completion -----------------------------------
-- Deviation from the brief noted and agreed earlier in this project: invoices
-- are generated when a PROJECT completes, not per milestone approval --
-- billing per milestone didn't match how this portal should work.
--
-- This inserts a draft invoice with amount_cents = 0; the schema has no
-- rate/pricing concept, so the real amount is something an admin fills in
-- before moving it out of 'draft'. Manufacturing a fake rate here would be
-- scope creep beyond what Phase 1's schema actually supports.
--
-- SECURITY DEFINER so this insert never depends on who triggered the update --
-- consistent with every other system-generated write in this project.

create or replace function public.generate_invoice_on_completion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into invoices (project_id, org_id, amount_cents, status)
    values (new.id, new.org_id, 0, 'draft');
  end if;
  return new;
end;
$$;

create trigger projects_generate_invoice_on_completion
  after update of status on projects
  for each row execute function generate_invoice_on_completion();
