-- Development.md lists "Comment on a deliverable" only under Client view.
-- The original comments_insert policy let admins in via `is_admin() or
-- org_id = current_org_id()`, contradicting the spec (and its own comment,
-- which already said "Clients can insert"). Admins should only ever read
-- comments left by the client.

drop policy comments_insert on comments;

create policy comments_insert on comments for insert
  to authenticated
  with check (org_id = current_org_id());
