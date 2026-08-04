# Client Portal

A single place for a client to see where their project actually stands: milestones,
deliverables, comments, hours, and invoices. Built on Next.js (App Router) and Supabase.
Clients see only their own organization's data — not because the UI hides it, but because
the database refuses to hand it over (Row Level Security on every table, plus matching
Storage policies).

See [Development.md](./Development.md) for the full project brief and phase-by-phase
build notes.

## Stack

- **Next.js (App Router)** + `@supabase/ssr` for the server/client boundary
- **Supabase** — Postgres, Auth, Storage, Edge Functions, Realtime
- **TypeScript**, with types generated from the schema (`npm run gen:types`), never hand-written
- **Tailwind + shadcn/ui**

> This project pins a Next.js version with breaking changes from the version most
> tooling/training data assumes — e.g. middleware lives in `proxy.ts` (exported function
> `proxy`), not `middleware.ts`. Check `node_modules/next/dist/docs/` before assuming
> familiar Next.js conventions.

## Prerequisites

- Node.js

That's it. Docker is **not** required to get a working local environment — see below.

## Local setup

```bash
git clone <repo-url>
cd client-portal
npm install
cp .env.local.example .env.local
npm run dev
```

No Supabase project invite, no shared secrets, no asking anyone anything — `.env.local.example`
is committed on purpose and points at the staging Supabase project, using its public
anon key (safe to commit; see the comment in that file for why). Staging is already
seeded with three test accounts (password `password123` for all):

| Email | Role | Org |
|---|---|---|
| `admin@example.com` | admin | — |
| `client@acme.test` | client | Acme Corp |
| `client@globex.test` | client | Globex Inc |

### Changing schema, RLS, storage policies, or Edge Functions

Only needed for this kind of change — day-to-day feature work doesn't need it. Install
the [Supabase CLI](https://supabase.com/docs/guides/cli) (no Docker required — these
commands talk straight to the staging project over the network, not to a local stack):

```bash
npm run supabase:link:staging   # one-time, links the CLI to staging
supabase migration new <name>    # creates a SQL file under supabase/migrations
supabase db push --linked         # applies your new migration(s) to staging
```

Then run the app against staging as usual (`npm run dev`, using `.env.local` from the
setup above) to verify the change. Once it looks right, the same `db push --linked`
(after `npm run supabase:link:production`) applies it to production.

There's a real tradeoff to know about: without a local Docker stack there's no disposable
"wipe and start over" sandbox — `db push --linked` writes directly to the real, shared
staging database. A broken migration or policy affects everyone using staging, and there's
no one-command reset; recovering means writing a fix-forward migration. That's an
acceptable cost for careful, reviewed schema changes, but worth keeping in mind.

## Seeing realtime sync

`milestones`, `comments`, and `deliverables` are the tables wired into Supabase
Realtime — changes broadcast live to every open session scoped to the same org (RLS
applies to realtime too, so a client only ever sees their own org's changes). To see it:

1. Open two sessions against the same environment (e.g. a normal window + an incognito
   window), logged in as two different users in the same org — admin + one of that org's
   clients works well.
2. In one session, trigger a change: approve a milestone, post a comment, or upload a
   deliverable.
3. Watch the other session update with no refresh.

This works identically locally (against `supabase start`'s local Realtime) and against a
deployed environment (staging/production) — realtime is driven by the database, not by
which frontend host you're on.

## Environment variables

Each environment (`local`, `staging`, `production`) gets its own env file
(`.env.local`, `.env.staging`, `.env.production` — all gitignored except the committed
`.env.local.example`, never commit real values beyond that). Variables:

| Variable | Where it's used | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | project API URL — the only variable `npm run dev` needs |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | public, ships in the browser bundle by design |
| `SUPABASE_SERVICE_ROLE_KEY` | server only (`lib/supabase/admin.ts`) | bypasses RLS — not required to run the app day to day; only pull this in if you're writing a privileged server action, and never expose it to the client |
| `SUPABASE_DB_PASSWORD` | CLI only (`supabase db query/push --linked`) | not read by the app itself, and only needed for the migration workflow above |
| `RESEND_API_KEY` | edge function (`send-invoice-email`) | set via `supabase secrets set`, not a Next.js env var |

## Migrations

No schema changes via the dashboard — if it isn't a migration in `supabase/migrations`,
it doesn't exist.

```bash
supabase migration new <name>          # create a new migration
npm run supabase:link:staging          # or supabase:link:production
supabase db push --linked               # apply to staging/production
```

See "Changing schema, RLS, storage policies, or Edge Functions" above for the full workflow.

## Types

```bash
npm run gen:types              # from local db
npm run gen:types:staging      # from the staging project
npm run gen:types:production   # from the production project
```

## Edge Functions

`send-invoice-email` fires from a Postgres trigger (`pg_net`) when a milestone is
approved and an invoice is generated — it looks up the org's clients and emails them via
Resend. Deploy per project:

```bash
supabase functions deploy send-invoice-email --project-ref <ref>
supabase secrets set RESEND_API_KEY=... INTERNAL_WEBHOOK_SECRET=... --project-ref <ref>
```

**Known limitation:** without a verified domain on Resend, emails can only be delivered
to the Resend account's own registered address — sends to real client addresses will
fail with a `403` until a domain is verified at resend.com/domains and the function's
`from` address is updated to use it.

## Deploying

Deploy the Next.js app (e.g. to Vercel) with `.env.production`'s values set as the
platform's environment variables, pointed at the production Supabase project.
