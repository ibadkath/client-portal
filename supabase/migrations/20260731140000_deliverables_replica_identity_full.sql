-- Confirmed live: deliverables removed by updateMilestoneStatus's
-- completed -> pending/in_progress cleanup (and by deleteDeliverable) were
-- actually deleted from the DB, but open project pages kept showing the
-- file until a hard reload. Cause: the deliverables realtime channel
-- filters DELETE events by `org_id=eq.${orgId}` (project-board.tsx), but
-- with the default REPLICA IDENTITY, Postgres only puts primary-key columns
-- in a DELETE's "old row" -- org_id isn't part of the primary key, so the
-- filter can never match and the event is silently dropped for every
-- subscriber. FULL replica identity includes every column in the old row,
-- letting the filter -- and the client's payload.old.id lookup -- work.

alter table deliverables replica identity full;
