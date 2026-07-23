# Client Portal — Project Brief

**Stack:** Next.js (App Router) · Supabase · TypeScript
**Duration:** 3-4 days
**Phases:** 6, sequential

---

## 1. The idea

Right now a client's project status lives in scattered places: Slack threads, emailed files, a spreadsheet of hours, an invoice PDF somewhere. This portal is the single place a client logs into to see where their project actually stands.

You're building both sides of it. Clients see their own projects and nothing else. Admins see everything across every client.

The heart of the project is that second sentence: **clients see nothing else** — not because the UI hides it, but because the database refuses to hand it over.

That distinction is the point of the whole exercise. Protecting data by not rendering it works right up until someone opens the network tab. Your Supabase anon key ships in the browser bundle; it is public by design. Anyone can take it, open a REST client, and query your database directly, with no React in the way. If the only thing standing between a client and someone else's invoices is a conditional render, there is nothing standing between them at all.

So every query has to answer the question *who is asking* — at the data layer, where it can't be bypassed. That question is most of what separates frontend work from fullstack work, and this project is built to make it unavoidable.

---

## 2. What it does

### Client view

- Log in, see only their own projects
- Track milestone progress on each project
- Download deliverables
- Comment on a deliverable
- Approve or reject a milestone
- View their invoices

### Admin view

- Create projects, assign to a client organization
- Define and sequence milestones
- Upload deliverables against a milestone
- Log hours against a project
- Issue invoices
- Dashboard across all clients

### Explicitly out of scope (for now)

Payments, notifications beyond email, file previews, client-side user management, and anything resembling a chat. If you find yourself building these, stop — you've drifted.

---

## 3. Stack, and why each piece

| Piece | Why it's here |
|---|---|
| **Next.js App Router** with `@supabase/ssr` | Server Components make the server/client boundary explicit. You'll learn where code actually executes, which is its own transition lesson. |
| **Supabase** | Postgres, Auth, Storage, Edge Functions, Realtime in one place. The point is the Postgres underneath, not the convenience on top. |
| **TypeScript** | Types generated from the schema, never hand-written. |
| **Tailwind + shadcn/ui** | So UI decisions don't eat the time budget. The UI is not what you're learning here. |

Use `@supabase/ssr`, **not** the older `auth-helpers` packages. They're deprecated and most tutorials you'll find still use them. Cookie handling between server and client is the single fiddliest part of Supabase + Next.js, and the current package exists because the old approach was painful.

---

## 4. Build phases

Do these in order. Each depends on the one before it, and the security model in particular falls apart if it's retrofitted onto a schema that wasn't designed for it.

### Phase 1 — Schema and auth

**Goal:** a data model that makes the security model expressible.

Design the schema before you write any UI. Propose it and walk me through it before building on top of it. This is a real review gate, not a formality — a wrong decision here costs you a week in phase 2.

**Entities:** `organizations` · `profiles` · `projects` · `milestones` · `deliverables` · `comments` · `invoices` · `time_entries`

**What to build:**

- Real foreign keys and constraints. Let the database reject bad data rather than trusting the app not to send it. `NOT NULL`, `CHECK` constraints on status enums, `ON DELETE` behaviour thought through for every relation.
- Supabase Auth with email/password plus magic link.
- A `profiles` table linked to `auth.users`, carrying organization membership and a role (`admin` / `client`).

**The question to get right:** How does the database know which organization a given row belongs to? Every RLS policy you write in phase 2 will start by answering that, so the answer needs to be cheap and reachable from every table. If figuring out "does this comment belong to my org?" requires four joins, your policies will be slow and hard to reason about. There's a tradeoff here between normalization and practicality. Come with a position on it.

**Also think about:**

- Can a user belong to more than one organization? (Decide now. It's painful later.)
- Is `admin` a property of a person, or of their membership in an org?
- What happens to deliverables when a project is deleted?

**Done when:** a schema diagram exists, migrations run clean from empty, and a user can sign up and log in.

### Phase 2 — Row Level Security

**Goal:** the database enforces isolation, with no help from the app.

This is the centre of the project. Every table gets policies. Assume the person querying is hostile and holds a valid anon key — because they do.

**What to build:**

- Clients read only rows belonging to their organization
- Admins read everything
- Clients can insert comments; clients can never write invoices
- Milestone approval is a client write, but only on their own milestones, and only on the status field

**Things that will bite you:**

- **RLS is off by default.** Enabling RLS on a table with no policies denies everything; a table with RLS never enabled allows everything to anyone with the anon key. Both failure modes are silent. There is no warning.
- **SELECT and UPDATE are separate policies.** A client who can read their milestone cannot necessarily update it, and a policy that allows the update may allow updating *any* column unless you constrain it. Column-level control is a different mechanism from row-level control.
- **Policies that query other tables can recurse.** A `profiles` policy that selects from `profiles` will hang. The usual escape is a `SECURITY DEFINER` function that reads the current user's org, bypassing RLS for that one lookup. Understand *why* it works before you paste it in.
- **auth.uid() is your entry point.** Everything flows from it. Get comfortable with what it returns and when it's null.
- **Policies run per row.** An unindexed column in a policy predicate means a sequential scan on every query. Index what you filter on.

**Prove it, don't assume it:** Write a test that authenticates as client A and requests client B's data **directly through the REST API**, bypassing your UI entirely. Use curl or a REST client with A's JWT. It must come back empty. A test that only goes through your own components proves nothing about your security — it proves your components work.

Do this for reads, writes, updates, and deletes, on every table.

**Done when:** cross-tenant access fails at the database, verified by tests that never touch the frontend.

### Phase 3 — Storage

**Goal:** files are as locked down as rows.

**What to build:**

- Deliverable uploads to Supabase Storage
- Storage policies mirroring your RLS rules
- Bucket structure that makes per-org access expressible as a policy
- Signed URLs with a sensible expiry for downloads

**The thing that surprises everyone:** Storage access control is a **separate system** from table access control. Locking down the `deliverables` table does not lock down the files it points at. A private bucket with no policies is a wall; a public bucket is a wall with the door removed, and the URL is guessable more often than people think.

Your bucket path structure *is* your security model — if the path is `org_id/project_id/filename`, you can write a policy against the first path segment. If it's `filename`, you can't write a policy at all. Decide the path structure before you upload the first file.

**Done when:** client A cannot fetch client B's file, even holding the direct storage URL.

### Phase 4 — Server-side logic

**Goal:** the database does work, rather than being a place you fetch from.

**What to build:**

- A Postgres function computing project progress from milestone status
- A trigger creating a `profiles` row automatically when a user signs up
- An Edge Function firing on milestone approval — generate the invoice, send the email (Resend is fine)

**Why this matters:** Progress computed in React is correct only when React runs. Progress computed in the database is correct always — including when a row is changed from the dashboard, by a script, or by next year's mobile app. This is the shift from "the database stores my data" to "the database maintains my invariants."

The signup trigger is worth dwelling on: it's the answer to "what if someone creates a user through a path my app doesn't control?" The app can't be the thing that guarantees a profile exists, because the app isn't the only way in.

**Done when:** project progress is correct after changing a milestone row directly in the Supabase dashboard, with the app not running.

### Phase 5 — Realtime

**Goal:** live updates, still correctly scoped.

Cheap to add once the foundation is right, and it's the moment the stack starts feeling worth it.

**What to build:**

- Comments appear live without a refresh
- Milestone status changes push to the admin dashboard

**Check this:** Realtime respects RLS, but only if you've configured it to. The default is not what you want. Confirm that a client subscribed to a table does not receive another org's rows over the websocket — open two browsers, log in as different orgs, and watch the network tab, not the UI.

Also: subscriptions leak. Clean them up on unmount, or you'll have five listeners on one table and a comment that appears five times.

**Done when:** two browsers side by side stay in sync, and the wrong browser never receives the wrong data.

### Phase 6 — Production concerns

**Goal:** this is the difference between having used Supabase once and being able to run it.

**What to build:**

- Migrations in git via the Supabase CLI. No schema changes made by clicking in the dashboard — if it isn't a migration, it doesn't exist.
- Seed data, so a fresh clone runs with `supabase start`
- Separate staging and production projects
- `supabase gen types` wired into the build, so TypeScript types come from the schema

**Why this phase isn't optional:** Every Supabase tutorial ends at phase 5. This is the part that makes you employable as a fullstack dev rather than someone who followed a tutorial. A schema that only exists in one hosted project's dashboard is a schema that cannot be reviewed, rolled back, or reproduced — and it's how teams end up afraid to touch their own database.

**Done when:** someone can clone the repo and have a working local environment without asking you anything.

---

## 5. Ground rules

| Rule | Why |
|---|---|
| Data model before UI | Screens built first force the schema to fit them, which is backwards |
| No schema changes in the dashboard | If it isn't a migration in git, it doesn't exist on staging |
| RLS on every table, no exceptions | A table without policies is public to anyone holding the anon key |
| Never trust the client for authorization | Hiding a route is a UX decision, not a security one |
| Types generated, never hand-written | Hand-written types drift from the schema silently, and nothing tells you |
| Test the API, not just the UI | Your UI is not the only client your database has |

---

## 6. Review checkpoints

Four points where we talk before you continue:

1. **After the schema proposal, before any UI.** The most important one.
2. **After RLS policies are written, before the app depends on them.** We'll try to break them together.
3. **After phase 4.** Checking that logic landed in the right layer.
4. **At the end.** Walkthrough as if you're handing it to another developer.
