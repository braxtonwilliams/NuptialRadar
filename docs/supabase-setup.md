# Supabase setup

Nuptial Radar stores sightings in **Supabase Postgres**, accessed from the browser via `@supabase/supabase-js`. Each visitor gets an **anonymous auth session** so their sightings persist across reloads on the same browser.

## Security

- **Do not put the database password in the app.** The password is for direct Postgres access (migrations, SQL editor) only.
- The browser uses the **Project URL** and **anon (public) key** from Supabase → **Project Settings → API**.
- If you ever shared the database password in chat or committed it, **rotate it** in Supabase → **Database → Database password**.

## 1. Create the table and policies

In Supabase Dashboard → **SQL Editor**, run the migration:

[`supabase/migrations/001_sightings.sql`](../supabase/migrations/001_sightings.sql)

This creates the `sightings` table and row-level security (RLS) so each user only reads/writes their own rows.

## 2. Enable anonymous sign-in

Dashboard → **Authentication** → **Providers** → **Anonymous sign-ins** → **Enable**.

The app calls `signInAnonymously()` on first load so every browser gets a stable `user_id` without email/password.

## 3. Environment variables

Copy `.env.example` to `.env` locally:

```bash
cp .env.example .env
```

Fill in:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Find both values under **Project Settings → API**.

Restart `npm run dev` after changing `.env`.

## 4. Vercel (production)

In Vercel → your project → **Settings → Environment Variables**, add the same two variables for **Production** (and Preview if you want sightings on preview deploys):

| Name | Value |
|------|--------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your anon public key |

Redeploy after saving. Vite inlines `VITE_*` vars at **build time**, so a new deploy is required when keys change.

## 5. Verify

1. Open the deployed or local app.
2. Click **📝** and log a test sighting.
3. In Supabase → **Table Editor → sightings**, confirm a row appears with a `user_id`.

If sightings fail with an auth error, confirm anonymous sign-in is enabled. If the table is missing, re-run the migration SQL.

## Behavior without Supabase

If env vars are missing, the forecast still works; only logging/deleting sightings is disabled (console warning on startup).

## Schema summary

| Column | Type | Notes |
|--------|------|--------|
| `id` | bigint | Auto-generated |
| `user_id` | uuid | Links to `auth.users` |
| `kind` | text | `sighting` or `queen_capture` |
| `latitude`, `longitude` | float | Capture location |
| `observed_at` | timestamptz | When the flight/capture occurred |
| `species`, `size_mm` | text / float | Taxonomy or queen size |
| `temp_c`, `humidity_pct`, … | float | Weather snapshot at observation time |
| `notes` | text | Optional |
| `created_at` | timestamptz | Row creation time |

## Code entry points

- `src/db/supabase.ts` — client, `initSupabase()`, anonymous auth
- `src/db/sightings.ts` — CRUD + in-memory cache for scoring
- `src/main.ts` — calls `initSupabase()` and `refreshSightingsCache()` at startup
