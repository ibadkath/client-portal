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
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker Desktop (only needed to run Supabase locally via `supabase start`)

## Local setup

```bash
npm install
supabase start        # spins up local Postgres, Auth, Storage, etc.
supabase db reset      # applies every migration + supabase/seed.sql
npm run dev
```

`supabase start` prints a local anon key, service role key, and API URL — put those in
`.env.local` (see below). `supabase db reset` runs `supabase/seed.sql`, which seeds three
accounts (password `password123` for all):

| Email | Role | Org |
|---|---|---|
| `admin@example.com` | admin | — |
| `client@acme.test` | client | Acme Corp |
| `client@globex.test` | client | Globex Inc |

## Environment variables

Each environment (`local`, `staging`, `production`) gets its own env file
(`.env.local`, `.env.staging`, `.env.production` — all gitignored, never commit real
values). Required variables:

| Variable | Where it's used | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | project API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | public, ships in the browser bundle by design |
| `SUPABASE_SERVICE_ROLE_KEY` | server only (`lib/supabase/admin.ts`) | bypasses RLS — never expose to the client |
| `SUPABASE_DB_PASSWORD` | CLI only (`supabase db query/push --linked`) | not read by the app itself |
| `RESEND_API_KEY` | edge function (`send-invoice-email`) | set via `supabase secrets set`, not a Next.js env var |

## Migrations

No schema changes via the dashboard — if it isn't a migration in `supabase/migrations`,
it doesn't exist.

```bash
supabase migration new <name>   # create a new migration
supabase db reset                # re-apply everything locally
supabase link --project-ref <ref>
supabase db push --linked        # apply to staging/production
```

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
