-- Revisiting Phase 1's signup trigger: the brief calls for public client
-- signup ("Done when: a user can sign up and log in"), not just
-- admin-provisioned invitations. A typed org_id is out (clients would be
-- guessing/pasting another org's UUID); the fix is letting self-signup
-- create its OWN organization by name instead of joining an existing one.
--
-- Two signup shapes now share this trigger:
--   - Public self-signup: metadata carries org_name, no org_id. The trigger
--     creates the organization and links the new profile to it.
--   - Admin-provisioned account (service role, e.g. a future invite flow):
--     metadata carries org_id directly, org_name is ignored.
-- Neither path lets a client join an org they didn't just create -- there is
-- still no way to attach yourself to an arbitrary existing org_id from the
-- public signup form, since org_id is never accepted from an unauthenticated
-- request in the app, only written here from trusted metadata.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := (new.raw_user_meta_data ->> 'org_id')::uuid;
  v_role text := coalesce(new.raw_user_meta_data ->> 'role', 'client');
begin
  if v_org_id is null and new.raw_user_meta_data ->> 'org_name' is not null then
    insert into public.organizations (name)
    values (new.raw_user_meta_data ->> 'org_name')
    returning id into v_org_id;
  end if;

  insert into public.profiles (id, role, org_id, full_name)
  values (new.id, v_role, v_org_id, new.raw_user_meta_data ->> 'full_name');

  return new;
end;
$$;
