-- Phase 4 revision: invoices are generated on MILESTONE approval, not project
-- completion, per the original brief ("An Edge Function firing on milestone
-- approval -- generate the invoice, send the email"). Supersedes the
-- project-completion trigger from 20260724150000_phase4_functions.sql.

drop trigger if exists projects_generate_invoice_on_completion on projects;
drop function if exists public.generate_invoice_on_completion();

-- invoices.milestone_id ------------------------------------------------------
-- Nullable for now (existing rows have none), but unique: a given milestone
-- can never own more than one invoice, so an approve -> reject -> re-approve
-- cycle can't double-bill.

alter table invoices
  add column milestone_id uuid references milestones (id) on delete cascade,
  add constraint invoices_milestone_id_unique unique (milestone_id);

create index invoices_milestone_id_idx on invoices (milestone_id);

-- Invoice generation on milestone approval -----------------------------------
-- Same amount_cents = 0 / draft-status reasoning as before: the schema has
-- no rate concept, so an admin fills in the real amount before it leaves
-- 'draft'. "on conflict do nothing" is the actual duplicate guard (the
-- status-transition check below just avoids a needless insert attempt on
-- every no-op update).

create or replace function public.generate_invoice_on_milestone_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into invoices (project_id, milestone_id, org_id, amount_cents, status)
    values (new.project_id, new.id, new.org_id, 0, 'draft')
    on conflict (milestone_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger milestones_generate_invoice_on_approval
  after update of status on milestones
  for each row execute function generate_invoice_on_milestone_approval();

-- Webhook: notify the send-invoice-email edge function on invoice insert ----
-- pg_net does the HTTP call async so the triggering transaction doesn't block
-- on an external API. The x-internal-secret header is not a credential -- the
-- function's real authority is its own service-role key, held server-side in
-- its env, never passed over the wire. This header is just enough to stop a
-- stranger from hitting the endpoint and forcing extra emails for a real
-- (unguessable) invoice id.

create extension if not exists pg_net;

create or replace function public.notify_invoice_created() returns trigger
language plpgsql security definer set search_path = public, net as $$
begin
  perform net.http_post(
    url := 'https://tqhnswcvobtcmrfkbopq.supabase.co/functions/v1/send-invoice-email',
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

create trigger invoices_notify_on_insert
  after insert on invoices
  for each row execute function notify_invoice_created();
