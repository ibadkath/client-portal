-- Phase 1: schema and auth. No RLS policies yet (Phase 2) and no signup trigger yet (Phase 4).

create extension if not exists pgcrypto;

-- organizations ---------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- profiles ----------------------------------------------------------------
-- One row per auth.users row. org_id is null only for admins: admin is a
-- role on the person, not a membership in any one client org.

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid references organizations (id) on delete restrict,
  role text not null check (role in ('admin', 'client')),
  full_name text,
  created_at timestamptz not null default now(),
  constraint client_requires_org check (role = 'admin' or org_id is not null)
);

create index profiles_org_id_idx on profiles (org_id);

-- projects ------------------------------------------------------------------

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete restrict,
  name text not null,
  description text,
  status text not null default 'active'
    check (status in ('active', 'completed', 'on_hold', 'cancelled')),
  created_at timestamptz not null default now()
);

create index projects_org_id_idx on projects (org_id);

-- milestones ------------------------------------------------------------

create table milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  title text not null,
  description text,
  sequence int not null,
  status text not null default 'pending'
    check (status in ('pending', 'in_review', 'approved', 'rejected')),
  due_date date,
  created_at timestamptz not null default now(),
  unique (project_id, sequence)
);

create index milestones_project_id_idx on milestones (project_id);
create index milestones_org_id_idx on milestones (org_id);

-- deliverables ------------------------------------------------------------
-- storage_path follows org_id/project_id/filename so Phase 3 storage
-- policies can match on the path's first segment.

create table deliverables (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references milestones (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  uploaded_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index deliverables_milestone_id_idx on deliverables (milestone_id);
create index deliverables_org_id_idx on deliverables (org_id);

-- comments ------------------------------------------------------------------

create table comments (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references deliverables (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  author_id uuid references profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index comments_deliverable_id_idx on comments (deliverable_id);
create index comments_org_id_idx on comments (org_id);

-- invoices ------------------------------------------------------------------

create table invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  amount_cents int not null check (amount_cents >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'overdue')),
  issued_at timestamptz,
  due_at timestamptz,
  created_at timestamptz not null default now()
);

create index invoices_project_id_idx on invoices (project_id);
create index invoices_org_id_idx on invoices (org_id);

-- time_entries ------------------------------------------------------------

create table time_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  admin_id uuid references profiles (id) on delete set null,
  hours numeric(5, 2) not null check (hours > 0),
  description text,
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);

create index time_entries_project_id_idx on time_entries (project_id);
create index time_entries_org_id_idx on time_entries (org_id);

-- org_id propagation --------------------------------------------------------
-- Every child table's org_id is derived from its parent by trigger, never
-- trusted from the app. This keeps Phase 2 RLS policies to a single indexed
-- equality check per table instead of a multi-join lookup, and it means a
-- caller can't spoof org_id to smuggle a row into another org.

create function set_milestone_org_id() returns trigger as $$
begin
  select org_id into new.org_id from projects where id = new.project_id;
  return new;
end;
$$ language plpgsql;

create trigger milestones_set_org_id
  before insert or update of project_id on milestones
  for each row execute function set_milestone_org_id();

create function set_deliverable_org_id() returns trigger as $$
begin
  select org_id into new.org_id from milestones where id = new.milestone_id;
  return new;
end;
$$ language plpgsql;

create trigger deliverables_set_org_id
  before insert or update of milestone_id on deliverables
  for each row execute function set_deliverable_org_id();

create function set_comment_org_id() returns trigger as $$
begin
  select org_id into new.org_id from deliverables where id = new.deliverable_id;
  return new;
end;
$$ language plpgsql;

create trigger comments_set_org_id
  before insert or update of deliverable_id on comments
  for each row execute function set_comment_org_id();

create function set_invoice_org_id() returns trigger as $$
begin
  select org_id into new.org_id from projects where id = new.project_id;
  return new;
end;
$$ language plpgsql;

create trigger invoices_set_org_id
  before insert or update of project_id on invoices
  for each row execute function set_invoice_org_id();

create function set_time_entry_org_id() returns trigger as $$
begin
  select org_id into new.org_id from projects where id = new.project_id;
  return new;
end;
$$ language plpgsql;

create trigger time_entries_set_org_id
  before insert or update of project_id on time_entries
  for each row execute function set_time_entry_org_id();
