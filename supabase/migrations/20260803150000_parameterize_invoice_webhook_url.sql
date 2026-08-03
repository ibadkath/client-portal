-- notify_invoice_created() (20260727120000_phase4_milestone_invoicing.sql)
-- hardcoded production's URL (https://tqhnswcvobtcmrfkbopq.supabase.co/...).
-- That was harmless while only one project existed; now that staging
-- (Phase 6) runs the same migration history, an invoice created on staging
-- would fire a webhook at production's edge function instead of its own.
--
-- Fix: read the base URL from a per-project Postgres setting instead of a
-- literal. A migration can't set this correctly itself -- the value is, by
-- definition, different on every project -- so it's set once per project
-- the same way an env var would be:
--   alter database postgres set app.settings.supabase_url = 'https://<ref>.supabase.co';
-- Every project this migration has ever run on needs that run once, by hand,
-- right after this migration lands (done for both staging and production
-- as part of this change).
--
-- If the setting is missing, warn and skip the webhook rather than raising:
-- this is a notification side effect, not a business rule, and a
-- misconfigured/forgotten setting shouldn't be able to block invoice
-- creation (and therefore milestone approval, which creates the invoice).

create or replace function public.notify_invoice_created() returns trigger
language plpgsql security definer set search_path = public, net as $$
declare
  v_base_url text := current_setting('app.settings.supabase_url', true);
begin
  if v_base_url is null or v_base_url = '' then
    raise warning 'app.settings.supabase_url is not set on this database -- skipping invoice-created webhook for invoice %', new.id;
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
