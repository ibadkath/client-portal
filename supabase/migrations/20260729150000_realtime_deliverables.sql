-- Confirmed live: after the deliverable upload was moved to a direct
-- browser->Storage upload (20260729 upload-size fix), the admin's own
-- upload never showed up in the open project page without a hard reload --
-- "completed" stayed disabled in the status dropdown even though the
-- deliverable row existed in the DB. Cause: ProjectBoard (project-board.tsx)
-- only subscribes to postgres_changes on milestones and comments (Phase 5),
-- and a Client Component's useState is only seeded from props on first
-- mount -- revalidatePath() re-rendering the Server Component parent with
-- fresh data does not reset that state. deliverables was never added to the
-- supabase_realtime publication, so there was no live-update path for it at
-- all, the same "opted out by default" gap Phase 5 already called out for
-- every other table.

alter publication supabase_realtime add table deliverables;
