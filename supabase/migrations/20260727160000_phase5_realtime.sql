-- Phase 5: Realtime. Postgres Changes are only broadcast for tables added to
-- the `supabase_realtime` publication -- every table starts opted out, which
-- is the "default is not what you want" the brief warns about. We opt in
-- only the two tables the brief actually asks for live updates on:
-- milestones (status pushed to the admin dashboard) and comments (appear
-- without a refresh).
--
-- RLS itself doesn't need any special "realtime mode" -- Supabase's Realtime
-- server evaluates each change against the connected user's own row-level
-- policies before deciding whether to forward it over their socket, the same
-- policies already enforced in supabase/migrations/20260723131336_phase2_rls.sql.
-- So a client subscribed to milestones only ever receives rows their existing
-- milestones_select policy (org_id = current_org_id()) would let them SELECT.

alter publication supabase_realtime add table milestones;
alter publication supabase_realtime add table comments;
