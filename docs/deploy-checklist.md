# Deploy checklist — Supabase + Vercel

Use this list in order. Dashboard steps need your Supabase/Vercel login; the repo is already configured for both.

---

## Part A — Push latest code (GitHub)

Vercel deploys from GitHub. The Supabase migration must be on `main` before production uses it.

- [ ] Commit and push all changes on `main` (includes `supabase/`, `src/db/supabase.ts`, `.env.example`, `vercel.json`)

```bash
git add -A
git commit -m "Add Supabase sightings backend and Vercel config"
git push origin main
```

---

## Part B — Supabase (one-time)

### B1. Security

- [ ] **Rotate database password** if you ever pasted it in chat or committed it  
  Supabase → **Project Settings → Database → Reset database password**

> The app never uses the database password. Only the **anon key** goes in env vars.

### B2. Run database migration

- [ ] Supabase Dashboard → **SQL Editor** → **New query**
- [ ] Paste contents of [`supabase/migrations/001_sightings.sql`](../supabase/migrations/001_sightings.sql)
- [ ] Click **Run**
- [ ] Confirm success (creates `sightings` table + RLS policies)

### B3. Enable anonymous auth

- [ ] **Authentication** → **Providers**
- [ ] Find **Anonymous sign-ins** → **Enable** → Save

Required so each browser gets a `user_id` without email/password.

### B4. Copy API credentials

- [ ] **Project Settings → API**
- [ ] Copy **Project URL** (e.g. `https://xxxxx.supabase.co`)
- [ ] Copy **anon public** key (under Project API keys — **not** the `service_role` key)

Keep these handy for Part C and D.

### B5. Optional — confirm in Table Editor

After first sighting (Part E): **Table Editor → sightings** should show rows with `user_id` filled.

---

## Part C — Local development (optional)

- [ ] Copy env template:

```bash
cp .env.example .env
```

- [ ] Edit `.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key...
```

- [ ] Restart dev server:

```bash
npm run dev
```

- [ ] Open http://localhost:5173 → log a test sighting with **📝**

---

## Part D — Vercel (production)

### D1. Connect repo (if not already)

- [ ] [vercel.com](https://vercel.com) → **Add New → Project**
- [ ] Import **braxtonwilliams/NuptialRadar** from GitHub
- [ ] Framework should auto-detect **Vite** (or use settings from `vercel.json`)

### D2. Build settings (verify)

| Setting | Value |
|---------|--------|
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

These match [`vercel.json`](../vercel.json) at repo root.

### D3. Environment variables

Vercel → your project → **Settings → Environment Variables**

Add for **Production** (and **Preview** if you want sightings on preview URLs):

| Name | Value |
|------|--------|
| `VITE_SUPABASE_URL` | Your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon public key |

- [ ] Save both variables
- [ ] **Redeploy** (Deployments → ⋯ on latest → Redeploy, or push a new commit)

Vite embeds `VITE_*` at **build time** — changing env vars without redeploying does nothing.

### D4. Production URL

- [ ] Open your `*.vercel.app` URL (or custom domain)
- [ ] Forecast loads without running `npm run dev` locally — Vercel serves the built site 24/7

---

## Part E — Verify end-to-end

- [ ] Production site loads (not a white screen)
- [ ] Location + forecast work
- [ ] Click **📝** → log sighting (species or size mm required)
- [ ] Supabase **Table Editor → sightings** shows the new row
- [ ] Green calibration note may appear under location when records are nearby

### If something fails

| Symptom | Fix |
|---------|-----|
| Sightings save fails / auth error | Enable **Anonymous sign-ins** (B3) |
| Table does not exist | Re-run migration SQL (B2) |
| Sightings work locally but not on Vercel | Add env vars + **redeploy** (D3) |
| White screen on Vercel | Check Deployments → build logs; ensure latest code is pushed |
| Forecast works but 📝 disabled | Missing `VITE_SUPABASE_*` env vars |

---

## Quick reference — what goes where

| Secret / value | Where it belongs |
|----------------|------------------|
| Database password | Supabase dashboard only — **never** in app or Vercel |
| `service_role` key | Server/admin only — **never** in browser or Vercel env for this app |
| `VITE_SUPABASE_URL` | `.env` locally + Vercel env |
| `VITE_SUPABASE_ANON_KEY` | `.env` locally + Vercel env |

---

## What you do **not** need

- Separate “dev” and “prod” Supabase projects (optional; one project is fine to start)
- A always-on Node server — Vercel serves static `dist/` files
- `npm run dev` for visitors — only for your local coding
