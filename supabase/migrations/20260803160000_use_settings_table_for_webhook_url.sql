-- Supersedes 20260803150000: that migration read the per-project base URL
-- via `current_setting('app.settings.supabase_url', true)`, set with
-- `alter database postgres set ...`. That ALTER fails on Supabase Cloud --
-- the hosted `postgres` role doesn't have privilege to set database-level
-- custom GUCs ("permission denied to set parameter"), only
-- `supabase_admin` does. A plain settings table needs no elevated
-- privilege: inserting a row is ordinary DML.

create table app_settings (
  key text primary key,
  value text not null
);

-- RLS on every table, no exceptions (project ground rule) -- no policies at
-- all here is intentional: this is never meant to be reachable through
-- PostgREST, only read from the SECURITY DEFINER trigger function below,
-- which runs as the table owner and bypasses RLS.
alter table app_settings enable row level security;
revoke all on app_settings from anon, authenticated;

create or replace function public.notify_invoice_created() returns trigger
language plpgsql security definer set search_path = public, net as $$
declare
  v_base_url text;
begin
  select value into v_base_url from app_settings where key = 'supabase_url';

  if v_base_url is null or v_base_url = '' then
    raise warning 'app_settings.supabase_url is not set -- skipping invoice-created webhook for invoice %', new.id;
    return new;
  end if;

  perform net.http_post(
    url := v_base_url || '/functions/v1/send-invoice-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', 'a3f9c2e7-5b1d-4e88-9a6f-2d7c8b4e0f31'
    ),
    body := jsonb_build_object(
      'invoice_id', new.id,
      'milestone_id', new.milestone_id,
      'project_id', new.project_id,
      'org_id', new.org_id,
      'amount_cents', new.amount_cents
    )
  );
  return new;
end;
$$;
