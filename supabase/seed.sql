-- Phase 6: seed data. Runs after every `supabase db reset` / fresh
-- `supabase start`, so a clone of this repo has a working local environment
-- without anyone hand-creating accounts through the signup form first.
--
-- Users are inserted straight into auth.users/auth.identities (the pattern
-- Supabase's own local-dev docs use) rather than going through the app's
-- signup flow, because seed.sql has no HTTP server to sign up against --
-- it only has a database connection. The on_auth_user_created trigger
-- (Phase 4) still fires on these inserts exactly as it would for a real
-- signup, so profiles are created the same way in both cases.
--
-- All three accounts share the password 'password123'.
--
--   admin@example.com     -- admin, no org
--   client@acme.test      -- client, Acme Corp
--   client@globex.test    -- client, Globex Inc

-- app_settings ------------------------------------------------------------
-- supabase_url is what notify_invoice_created() (Phase 4/6) calls out to on
-- invoice creation; it's a per-project value (20260803160000), and the
-- local API's own URL is the correct one for a local `supabase start`.

insert into app_settings (key, value) values
  ('supabase_url', 'http://127.0.0.1:54321');

-- organizations -------------------------------------------------------------

insert into organizations (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Acme Corp'),
  ('22222222-2222-2222-2222-222222222222', 'Globex Inc');

-- auth.users / auth.identities ------------------------------------------
-- raw_user_meta_data feeds handle_new_user() (Phase 4/1), which is what
-- actually creates the matching profiles row -- role and org_id come from
-- here, not from a separate profiles insert.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, recovery_sent_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'a0000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated',
    'admin@example.com', crypt('password123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{"role":"admin","full_name":"Ada Admin"}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a0000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated',
    'client@acme.test', crypt('password123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{"role":"client","full_name":"Cara Client","org_id":"11111111-1111-1111-1111-111111111111"}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a0000000-0000-0000-0000-000000000003',
    'authenticated', 'authenticated',
    'client@globex.test', crypt('password123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{"role":"client","full_name":"Gary Globex","org_id":"22222222-2222-2222-2222-222222222222"}',
    now(), now(), '', '', '', ''
  );

insert into auth.identities (
  id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
)
select
  u.id, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email', u.id::text, now(), now(), now()
from auth.users u
where u.id in (
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000003'
);

-- projects ------------------------------------------------------------------

insert into projects (id, org_id, name, description, status) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Website Redesign', 'Full redesign of the Acme marketing site.', 'active'),
  ('b0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Mobile App Launch', 'v1 of the Globex companion app.', 'active');

-- milestones ------------------------------------------------------------
-- Inserted directly at their target status. enforce_milestone_client_update()
-- only restricts *who* can move a milestone *through the app* -- with no
-- JWT on this session (auth.uid() is null), it returns immediately and lets
-- every insert through, same as any other trusted, service-role write.

insert into milestones (id, project_id, title, description, sequence, status, due_date) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'Discovery & Wireframes', 'Audit current site, propose sitemap and wireframes.', 1, 'approved', current_date - 21),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001',
   'Visual Design', 'High-fidelity mockups for key pages.', 2, 'completed', current_date - 7),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001',
   'Development', 'Build out the approved designs.', 3, 'in_progress', current_date + 14),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001',
   'Launch', 'DNS cutover and post-launch QA.', 4, 'pending', current_date + 30),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002',
   'Requirements', 'Feature spec and platform decisions.', 1, 'approved', current_date - 14),
  ('c0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000002',
   'UI Design', 'Screen-by-screen designs for v1.', 2, 'in_progress', current_date + 21);

-- time_entries ------------------------------------------------------------
-- Required to exist before a deliverable can be uploaded to either project
-- (require_time_entry_before_deliverable_upload, Phase 6-adjacent business
-- rule from this session) -- so these come before the deliverables below.

insert into time_entries (project_id, admin_id, hours, description, entry_date) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 6.5, 'Stakeholder interviews and sitemap draft', current_date - 20),
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 8.0, 'Wireframes for homepage and product pages', current_date - 18),
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 5.0, 'Visual design pass on homepage', current_date - 9),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 4.0, 'Requirements workshop with Globex team', current_date - 13);

-- deliverables ------------------------------------------------------------
-- storage_path follows org_id/project_id/filename (Phase 3 convention) even
-- though no matching object exists in local Storage -- seed.sql only seeds
-- Postgres, not the Storage emulator's disk.

insert into deliverables (id, milestone_id, storage_path, file_name, uploaded_by) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111/b0000000-0000-0000-0000-000000000001/wireframes.pdf',
   'wireframes.pdf', 'a0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111/b0000000-0000-0000-0000-000000000001/homepage-mockup.png',
   'homepage-mockup.png', 'a0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000005',
   '22222222-2222-2222-2222-222222222222/b0000000-0000-0000-0000-000000000002/requirements.pdf',
   'requirements.pdf', 'a0000000-0000-0000-0000-000000000001');

-- deliverable_downloads / comments ---------------------------------------
-- Both deliverable_downloads.user_id and comments.author_id are forced by
-- trigger to auth.uid() (never trusted from the insert), so simulate each
-- client's session via request.jwt.claims for these inserts -- the same
-- mechanism PostgREST uses to populate auth.uid() for a real request.

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);

insert into deliverable_downloads (deliverable_id) values
  ('d0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002');

insert into comments (deliverable_id, body) values
  ('d0000000-0000-0000-0000-000000000001', 'These wireframes look great, approving this milestone.'),
  ('d0000000-0000-0000-0000-000000000002', 'Love the new homepage direction. Can we try a darker header?');

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text,
  true
);

insert into deliverable_downloads (deliverable_id) values
  ('d0000000-0000-0000-0000-000000000003');

insert into comments (deliverable_id, body) values
  ('d0000000-0000-0000-0000-000000000003', 'Requirements doc reviewed and looks complete. Approved.');

select set_config('request.jwt.claims', '', true);

-- invoices ------------------------------------------------------------------

insert into invoices (project_id, amount_cents, status, issued_at, due_at) values
  ('b0000000-0000-0000-0000-000000000001', 450000, 'paid', current_date - 5, current_date + 25),
  ('b0000000-0000-0000-0000-000000000002', 180000, 'sent', current_date - 2, current_date + 28);
