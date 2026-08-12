# Nuptial Radar — Project Guide

This document describes everything implemented in Nuptial Radar: what the app does, how it is structured, how predictions are computed, and how local sighting data feeds back into the forecast.

---

## Table of contents

1. [Overview](#overview)
2. [Goals and design decisions](#goals-and-design-decisions)
3. [Technology stack](#technology-stack)
4. [Project structure](#project-structure)
5. [User-facing features](#user-facing-features)
6. [Location and geocoding](#location-and-geocoding)
7. [Weather data pipeline](#weather-data-pipeline)
8. [Forecast views](#forecast-views)
9. [Prediction system](#prediction-system)
10. [Local sightings database](#local-sightings-database)
11. [Local calibration layer](#local-calibration-layer)
12. [UI and interaction design](#ui-and-interaction-design)
13. [Persistence and browser storage](#persistence-and-browser-storage)
14. [Build, deployment, and configuration](#build-deployment-and-configuration)
15. [Known limitations](#known-limitations)
16. [Development history](#development-history)
17. [Attribution and license](#attribution-and-license)

---

## Overview

**Nuptial Radar** predicts when queen ants are likely to undertake nuptial (mating) flights near a user’s location. It combines:

- **Machine-learning models** from the open-source [nuptialflight](https://github.com/bradrushworth/nuptialflight) project (random forests trained on crowd-sourced sightings)
- **Live weather forecasts** from Open-Meteo (no API key required)
- **User-logged sightings** stored in **Supabase Postgres** (via anonymous auth) that nudge probabilities toward conditions where flights were actually observed nearby

The app is a static front-end deployed on Vercel. Weather is fetched from public APIs, models are bundled as static JSON, preferences stay in `localStorage`, and sightings sync to Supabase when configured.

---

## Goals and design decisions

### Recreate nuptialflight as a website

The original [nuptialflight](https://github.com/bradrushworth/nuptialflight) mobile app focuses heavily on **today’s** flight probability. Nuptial Radar expands that into a **multi-day planning tool** with 24-hour, 7-day, and (when conditions warrant) full-month views.

### Open-Meteo weather data

Nuptial Radar uses [Open-Meteo](https://open-meteo.com/) (no API key). RF features use **sea-level pressure (`pressure_msl`)** so inputs match OpenWeatherMap’s `pressure` field that trained the nuptialflight models. Live daily rows are enriched from hourly aggregates (temp/humidity/wind/etc.).

Scores can still differ slightly from the mobile app because the underlying weather models differ (Open-Meteo vs OpenWeatherMap). Closest comparison: **🌲 Forest v1**, **🐜 All species**, hourly anchor **⏱ from now** (now the default for new visitors). Week/day card colors use the **daily RF model**; the 24-hour histogram uses **hourly RF** scores.

### Forest v1 production scoring

Production uses **Forest v1** only — the original nuptialflight RF scoring. With **All species**, display % matches raw RF (no extra timing multipliers). Hybrid / literature modules remain in the repo for reference but are not registered or selectable in the UI.

### Supabase for sightings

Sightings and queen captures are stored in **Supabase Postgres**, accessed from the browser with `@supabase/supabase-js`. **Anonymous auth** gives each browser a persistent user id without sign-up. Row-level security ensures users only see their own records. See [supabase-setup.md](./supabase-setup.md).

### Graceful location fallback

GPS denial, timeout, or non-HTTPS contexts no longer dead-end the app. The flow falls back to IP-based approximate location, city search, or an explicit location picker.

---

## Technology stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript |
| Bundler / dev server | Vite 6 |
| UI | Vanilla TypeScript + CSS (no React/Vue) |
| ML inference | Custom random-forest loader (`forest-model.ts`) |
| Sightings database | Supabase Postgres + `@supabase/supabase-js` |
| Hosting | Vercel (static `dist/` build) |
| Weather | Open-Meteo Forecast, Climate, Archive, and Geocoding APIs |
| IP geolocation fallback | ipwho.is |
| Fonts | DM Sans (Google Fonts) |

### npm scripts

```bash
npm install      # Install dependencies
npm run dev      # Development server (default port 5173)
npm run build    # TypeScript check + production build → dist/
npm run preview  # Serve production build locally
```

---

## Project structure

```
NuptialRadar/
├── supabase/
│   └── migrations/
│       └── 001_sightings.sql    # Postgres schema + RLS policies
├── docs/
├── public/
│   └── models/
│       ├── final_model.json       # Daily random-forest model (from nuptialflight)
│       └── hour_model.json        # Hourly random-forest model (from nuptialflight)
├── src/
│   ├── main.ts                    # App entry, UI rendering, event wiring
│   ├── style.css                  # All styles (dark theme)
│   ├── types.ts                   # Shared TypeScript interfaces
│   ├── nuptials.ts                # Original RF scoring + size-seasonal logic
│   ├── forest-model.ts            # JSON model loader and DecisionTree/Forest classes
│   ├── weather.ts                 # Open-Meteo fetch, geocoding, weather snapshots
│   ├── forecast-views.ts          # 24h / 7d / month view builders
│   ├── sightings-ui.ts            # Sighting log modal and floating button
│   ├── algorithms/
│   │   ├── types.ts               # FlightAlgorithm interface
│   │   ├── registry.ts            # Algorithm list, cycling, localStorage persistence
│   │   ├── scoring.ts             # Routes all scoring + local calibration
│   │   ├── nuptials-forest-v1.ts    # Production RF wrapper
│   │   ├── nuptials-hybrid-v2.ts    # Literature + RF fusion
│   │   ├── literature-scoring.ts    # Published weather suitability functions
│   │   ├── references.ts            # Bibliography and parameter constants
│   │   └── local-calibration.ts     # Sighting-based probability adjustment
│   └── db/
│       ├── types.ts               # SightingRecord, WeatherSnapshot, etc.
│       ├── supabase.ts            # Supabase client, anonymous auth init
│       └── sightings.ts           # CRUD + in-memory cache for scoring
├── .env.example                   # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### Module responsibilities

| Module | Role |
|--------|------|
| `main.ts` | Orchestrates loading, location flow, forecast rendering, floating controls |
| `nuptials.ts` | Core nuptialflight feature engineering and RF calls; size-class seasonality |
| `algorithms/scoring.ts` | Single entry point for all probability scores; Forest v1 then timing/species layer |
| `species/*` | Genus catalog + geographic ranges, rain/month/hour timing, selection, selector UI |
| `forecast-views.ts` | Builds `DayForecast` objects, month calendar cells, 24h strip data |
| `weather.ts` | Fetches 16-day hourly forecast, climate fill for month view, archive weather for past sightings |
| `db/*` | Supabase client, sightings CRUD, calibration cache |
| `sightings-ui.ts` | Modal form for logging/deleting sightings |

---

## User-facing features

### Multi-range forecast

- **24 Hour** — Compact color strip for the next 24 hours; highlights green windows (≥55%)
- **7 Day** — Daily cards for the current week; click a day for hourly chart and weather detail
- **Month** — Full calendar for the current month (only shown if at least one hourly slot in the live forecast reaches green)

### Day detail panel

When a day is selected (7-day or month view):

- Flight status text (e.g. “Flight likely — probably medium species”)
- 11 AM, day overall, and 7 PM score boxes
- Hourly bar chart of flight probability
- Full weather grid (temp, dew point, humidity, wind, pressure, clouds, rain chance, UV)
- **Species size likelihood** — small / medium / large queen seasonal multipliers

### Confidence display

- Toggle between **emoji** and **percentage** display (% / 🐜 button, top-right)
- Color scale: red &lt;50%, amber 50–54%, green ≥55%
- Emoji ladder: 👎 🤏 🤞 🐜👌 🐜👍 🐜💪 🐜🫶

### Best Day badge

On the 7-day view, **Best day** appears only on the day with the highest daily percentage **among days that have at least one green hourly slot**. If no day has a green hourly window in the visible week, the badge is hidden entirely.

### Green hourly indicator

Days with any hourly slot ≥55% show a 🟢 on day cards and month cells.

### Biology insights

In **full (non-compact) layout**, day detail and the 24-hour view always show activity, RF confidence, rain context, and time window fused into the flight status / outlook — no separate toggle. Prediction always uses Forest v1.

### Species filter (🐜)

Top-bar **🐜 All** (or selected genus) opens a searchable genus list (Tab to autocomplete). The list is **filtered to genera native or established (including invasive) at the current forecast location** (country / US state from reverse geocode; lat/lon bands as a backup). Genera not present there are hidden.

Selecting a genus:

- Adjusts displayed % via month / local-hour / rain-lag multipliers
- Shows a **Best windows** panel (top days/times for that genus)
- Enables **ℹ** documentation (range note, flight pattern, month chips, hour timeline, sources)
- Autocomplete badges: **🟢** if that genus has a green window in the loaded forecast; **1️⃣** on the highest-peak genus (among location-filtered genera)

Clear with **All species**. Persisted as `nuptial-radar-species`. Green hourly bars also show an 🐜 tip with the top genera for that slot (always, regardless of selector).

### Sighting logger

Floating **📝** button opens a modal to:

- Log a **nuptial flight sighting** or **queen capture**
- Set **time** (defaults to now)
- Set **location** (prefilled from forecast location, manual lat/lon, or GPS)
- Enter **species name** or **queen size in mm** (one required)
- Add optional notes
- View and delete past records

When sightings exist near the current location, a green note appears under the location name: *“N local records calibrating forecasts”*.

### Location

- City search (Open-Meteo geocoding)
- **Approximate location** from IP on first visit or via button on the location picker
- Saved location restored on return visit
- Startup: saved location → IP approximate → location picker (search or approximate)
- **Nearby towns** (US): top-left **📍 Nearby** dropdown always visible; ranks towns within 25 miles vs a **fixed starting location**; green badge when any town is better; tap previews a town without changing the home origin (⌂ returns home)

Main forecast location uses city search or IP approximate only (no browser GPS).

---

## Location and geocoding

### Search

`searchLocations()` calls the Open-Meteo Geocoding API with **query normalization** (`geocoding-query.ts`):

- **Place prefixes:** `ft`/`st`/`mt`/`pt`/`lk`/`ste` → Fort, Saint, Mount, Point, Lake, Sainte (periods stripped: `St.` → `St`)
- **US states:** `ft smith arkansas` → `Fort smith, Arkansas`, `Fort smith`
- **US territories:** `St Thomas USVI` → `Saint Thomas, VI` (+ `countryCode=VI`); also **PR**, **GU**, **AS**, **MP**
- **USVI islands:** St Thomas, St Croix, St John map to their island admin regions

**`location-search-ui.ts`** binds search once at startup via document-level event delegation, debounces input (~280 ms), shows an autocomplete dropdown, and supports keyboard navigation (↑/↓, Enter, Escape). Selecting a result calls `loadLocation()`.

The search bar lives in a **sticky top row** below the floating toolbar (all layouts), so it is never covered by the fixed control buttons on mobile. In compact mode, the current location appears as a label above the search field.

### Reverse geocode

`reverseGeocode()` uses **BigDataCloud** reverse geocode (Open-Meteo only offers forward search). It returns a display name plus a structured **`place`** (`countryCode`, `admin1`, `usState`, lat/lon). `fetchWeather()` always attaches `weather.place` for species range filtering. US territories (PR, VI, etc.) are normalized to their own country codes when reverse geocode nests them under US.

### IP approximate location

`fetchApproximateLocation()` calls `https://ipwho.is/` for a network-based estimate.

### Hints

The location picker offers city search or approximate location from your network.

### Saved location

Key: `nuptial-radar-location` — JSON `{ lat, lon, name }`.

### Nearby towns scan

**Files:** `src/nearby/*`, `src/geo/distance.ts`, `fetchWeatherLite` in `weather.ts`

When the forecast place is in the US (or US lat/lon band when country is still resolving):

1. Discover named places via **BigDataCloud** reverse geocode at the origin and on rings (~8 / 14 / 22 mi) — Open-Meteo has no reverse geocoding API
2. Prefer same-state hits between 2.5–25 miles (max 6 towns); if state is unknown, any US town in range. **Exclude the home locality name** so the starting city is not listed twice (BigDataCloud often labels nearby ring points as the same city).
3. Fetch a 2-day **lite** forecast per town (independent of the on-screen location; no climate fill)
4. Score with the current algorithm + genus selection; compare peak hourly % to a **snapshot** of home scores
5. Cache under `nuptial-radar-nearby-scan` for **~18 hours** (keyed by origin + algorithm + species); refresh automatically on open when stale

UI: top-left **📍 Nearby** control is always shown with the forecast. It opens a ranked dropdown (distance, best time, peak %, better/worse vs **home**). A green count badge appears only when at least one town beats home peak %. **Tapping a town** previews that forecast but does **not** change the starting location or rescan origin — use **⌂ home** in the list to return. A new search / GPS / approximate location sets a new home.

---

## Weather data pipeline

### Live forecast (up to 16 days)

`fetchWeather()` calls the Open-Meteo **Forecast API**:

- Hourly: temperature, humidity, dew point, pressure, clouds, precipitation probability, wind speed/gusts, UV
- Daily: min/max/day temp, humidity, dew point, pressure, wind, clouds, pop, UV, weather code

Open-Meteo’s free tier provides **16 days of hourly data**. This limit is exposed as `FORECAST_DAY_LIMIT = 16` in `types.ts`.

### Extended month fill (climate estimates)

For the **Month** view, days beyond the 16-day hourly horizon are filled using the Open-Meteo **Climate API** (`climate-api.open-meteo.com`). These days:

- Show daily-level estimates only (no hourly chart)
- Are marked with a **~** badge and “Climate average · daily estimate only” in detail
- Use `isEstimate: true` on `DailyWeather` and `DayForecast`

### Weather snapshots for sightings

When logging a sighting, `fetchWeatherSnapshot(lat, lon, at)` retrieves conditions at capture time:

- **Recent dates** (within ~2 days of now): Forecast API hourly data
- **Past dates**: Archive API (`archive-api.open-meteo.com`) hourly data for that calendar day

The nearest hourly timestep to the observation time is selected.

### Variable mapping

Open-Meteo fields are converted into the structures expected by nuptialflight models. **Sea-level pressure (`pressure_msl`)** is mapped to the RF `pressure` feature (OWM parity). Live daily rows are rebuilt from hourly aggregates via `enrichDailyFromHourly()`.

---

## Forecast views

### 24-hour glance

Uses the **hourly anchor** preference (🕛 full day from midnight · ⏱ 24 hours from current hour). Default is **from now** (nuptialflight mobile histogram style); toggle to midnight for the full calendar day.

The UI renders:

- A color strip (one block per hour; absolute % for color and height)
- Summary line (green window count, peak % and time)
- Toggle to switch midnight ↔ from-now (persisted in `localStorage`)
- On every **green** hour: an 🐜 icon above the block; hover/focus lists the top **in-season** local genera for that slot (range-filtered + season/hour/rain on base RF), independent of the 🐜 selector

### Hourly charts

Bar **height and color** both use the absolute hourly percentage (0–100%), matching nuptialflight’s today histogram — not normalized to the day’s peak. Green bars (day detail and compact hourly) show the same 🐜 hover tip as the 24-hour glance.

### Month calendar

`buildMonthCalendar()` lays out weeks for the current local month:

- **Live forecast** cells — from hourly/daily API data
- **Climate estimate** cells — extended daily only
- **🟢** — day has a green hourly slot (live days only)
- Clicking a cell selects that day for the detail panel

The Month tab is **hidden** unless `hasGreenTimeSlot()` is true for the loaded hourly scores (at least one ≥55% slot exists in the live forecast).

---

## Prediction system

All scoring flows through `src/algorithms/scoring.ts`, which:

1. Calls **Forest v1** from the registry
2. Skips **local calibration** for Forest v1 (matches nuptialflight raw model output; calibration path remains for any future non-Forest algorithm)
3. Applies the **genus timing layer** (`species/timing.ts`) **only when a genus is selected** — season ramp (day-of-year peak/shoulders), rain lag, local hour. **All species** leaves the algorithm score unchanged (nuptialflight parity)

**Biology insights** are always shown in full (non-compact) day detail and 24-hour outlook: confidence (RF tree disagreement), activity band, rain status, and time window — **display only**; percentages always come from Forest v1 (+ genus timing when selected).

### Confidence thresholds (Forest v1)

| Threshold | Value | Meaning |
|-----------|-------|---------|
| Green | ≥ 55% | Flight likely |
| Amber | ≥ 50% | Flight possible |
| Below amber | &lt; 50% | Flight unlikely |

### Forest v1 (production)

**ID:** `forest-v1`  
**File:** `nuptials-forest-v1.ts`

Wraps `nuptials.ts` without modification:

- `nuptialDailyPercentageModel()` — daily RF + feature engineering
- `nuptialHourlyPercentageModel()` — hourly RF + feature engineering

**Hard gates** (from nuptialflight): if temperature &lt; 5 °C, wind &gt; 15 m/s, or gust &gt; 20 m/s → probability ≈ 0.01.

**Feature engineering** includes cyclical day-of-year (sin/cos), hemisphere flag, dew-point depression, antecedent rain from daily pop, moon phase, and related terms fed into the bundled JSON forests.

**Models:**

- `public/models/final_model.json` — daily
- `public/models/hour_model.json` — hourly

Loaded once at startup via `ensureModelsLoaded()` in `forest-model.ts`.

### Hybrid v2 (legacy / not in UI)

**ID:** `hybrid-literature-v2`  
**Files:** `nuptials-hybrid-v2.ts`, `literature-scoring.ts` (not registered)

Source remains for reference. It blended RF with literature suitability; production no longer exposes a switcher.

### Biology insights (full layout)

**Files:** `biology-insights.ts`, `biology-v3-features.ts`

Not a separate scoring algorithm. In non-compact mode, fused into day detail / 24-hour outlook:

- **Confidence** — std dev of per-tree P(flight) from the bundled RF
- **Activity** — descriptive band from the displayed % (Very Low → Exceptional)
- **Rain / window** — recent rain context and diurnal window label

Derived features (pressure trends, GDD, soil moisture estimate, etc.) are computed in `biology-v3-features.ts` for a future v4 retrain but **do not** affect current scores.

### Timing and species layer

**Files:** `src/species/catalog.ts`, `range.ts`, `timing.ts`, `selection.ts`, `species-ui.ts`

After Forest v1 scoring:

| Mode | Behavior |
|------|----------|
| **All species** | Identity — display % = algorithm output (Forest v1 = nuptialflight RF) |
| **Genus selected** | `p × seasonBlend × rainBlend × hourBlend` |

**Season ramps (source of truth):** each genus has a northern-hemisphere `FlightSeason` (`peakStart` / `peakEnd` day-of-year, `rampDays`, `fadeDays`). A continuous `seasonFactor` (0→1→0) climbs through the ramp, holds at 1 through the peak, then fades — so early shoulder months are very low, core peak ≈ RF, and the season does not cliff to zero the day after the peak ends. Southern latitudes shift the evaluation DOY by ~6 months. Month chips in ℹ are mid-month samples of that curve.

**Season strength:** if `seasonFactor < 0.05`, the genus is treated as out of season (~1%). Otherwise `seasonBlend = 0.05 + 0.95 × seasonFactor`. Hour/rain stay soft (≈0.72 + 0.28×factor). No-rain forecasts are **neutral** for rain (factor 1).

**Green-bar 🐜 tips:** rank local genera with the same season-aware scoring; **omit** genera with `seasonFactor < 0.08` so winter / far-off-season names do not appear.

**Catalog (major New World / US + Caribbean genera):** Camponotus, Solenopsis, Crematogaster, Pheidole, Formica, Lasius, Myrmica, Pogonomyrmex, Trachymyrmex, Tetramorium, Brachymyrmex, Dorymyrmex.

Each profile includes a **`range`** (ISO country codes, optional US states, lat/lon bands, native / invasive / established). The 🐜 dropdown and green/#1 badges only include genera present at `weather.place`.

Hourly Open-Meteo `rain` mm is stored on `HourlyWeather` for wet-hour detection.

### Species size hints

Separate from the RF/hybrid score, `sizeSeasonalPercentages()` applies **monthly multipliers** per size class (small / medium / large queens) based on hemisphere tables in `nuptials.ts`. These adjust display percentages for “which size queen is most likely today” — they do not change the core flight probability. When a genus is selected, the matching size row is highlighted in the size breakdown.

### Algorithm registry

`registry.ts` maintains `ALGORITHM_REGISTRY`, cycles on button click, and persists the active ID to `localStorage` key `nuptial-radar-algorithm`.

---

## Sightings database (Supabase)

### Technology

- **[Supabase](https://supabase.com/)** — hosted Postgres with auth and row-level security
- **Client** — `@supabase/supabase-js` in `src/db/supabase.ts`
- **Auth** — anonymous sign-in on startup (`initSupabase()`); session stored by Supabase client
- **Cache** — sightings loaded into memory at startup (`refreshSightingsCache()`) so scoring stays synchronous
- **Setup guide** — [supabase-setup.md](./supabase-setup.md)

### Schema

See `supabase/migrations/001_sightings.sql`. Core columns match the former SQLite design, plus `user_id uuid` referencing `auth.users`.

### CRUD API (`db/sightings.ts`)

| Function | Purpose |
|----------|---------|
| `refreshSightingsCache()` | Fetch up to 500 rows from Supabase into memory |
| `insertSighting(input)` | Insert record + weather snapshot (async) |
| `listSightings(limit)` | Read from in-memory cache (most recent first) |
| `deleteSighting(id)` | Delete row and update cache (async) |
| `getSightingsCount()` | Cache length |
| `getSightingsForCalibration()` | Full cache for scoring |
| `formatSightingLabel(record)` | Human-readable list label |
| `sightingWeatherSnapshot(record)` | Rebuild `WeatherSnapshot` from stored columns |

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are unset, sightings are disabled and the forecast still loads.

### Sighting kinds

- **`sighting`** — nuptial flight observed (alates in air)
- **`queen_capture`** — queen collected; weighted higher in calibration

---

## Local calibration layer

**File:** `algorithms/local-calibration.ts`  
**Applied in:** `algorithms/scoring.ts` after base algorithm — reserved for non-Forest algorithms (**skipped for Forest v1** so production scores match nuptialflight)

### Intent

When the user has logged flights or captures nearby, the app **nudges** probabilities toward conditions that historically co-occurred with those events — without replacing the global models entirely.

### Matching logic

For each sighting with stored weather:

1. **Distance filter** — skip if farther than **120 km** (haversine)
2. **Distance weight** — `exp(-dist / 45 km)`
3. **Kind weight** — queen capture ×1.25, sighting ×1.0
4. **Size weight** — queens ≥8 mm ×1.05
5. **Weather similarity** — Gaussian-like comparison on:
   - Temperature (σ ≈ 4.5 °C)
   - Humidity (σ ≈ 18%)
   - Wind (σ ≈ 3.5 m/s)
   - Rain pop (σ ≈ 0.22)
   - Month of year (σ ≈ 1.8 months)
   - Hour of day for hourly scores (σ ≈ 3.5 h)

### Blending

```
strength = min(0.40, 0.10 + matchCount × 0.05)
localFlightPrior = 0.52 + boost × 0.45
blended = baseProb × (1 - strength) + localFlightPrior × strength × boost
```

If no nearby matches or boost ≤ 0.05, the base model score is returned unchanged.

### UI feedback

`getLocalCalibrationSummary()` drives the note under the location name showing match count and distance to nearest record.

---

## UI and interaction design

### Layout

- Max width ~1100 px, centered
- **Dark theme only** (`data-theme="dark"` on `<html>`; light mode removed)
- **Simple / compact mode** via toggle (`data-simple="true"`) — smaller header chrome, 7-day strip with tap-to-select days, and a **compact hourly panel** (11 AM / day / 7 PM scores + bar chart) below the week row; hides legend, footer, and full day-detail panel
- Radial gradient background accents

### Floating controls (full-width top bar)

- Fixed across the top of the viewport (safe-area aware)
- **📍 Nearby** (top left) — always visible with the forecast; opens nearby towns dropdown; green count badge when any town has a higher peak % than home; scan refreshes when cache is older than ~18h
- Right cluster (scrollable if needed):
  - **⊟ / ⊞** — compact **simple layout** (defaults **on**): week strip + **hourly panel** for the selected day (score boxes + bar chart); tap a day to change hours — tap ⊞ for full detail (includes biology insights), legend, and footer
  - **% / 🐜** — toggle numeric vs emoji display
  - **🐜** — genus filter / search (+ **ℹ** docs when a genus is selected)
  - **📝** — open sighting modal (badge shows record count)

Location search sits below the bar so controls never cover it.

### Loading and error states

- **Loading screen** — spinner + message during model load, weather fetch, GPS
- **Error screen** — message + retry + choose location
- **Location prompt** — full-screen picker with search and approximate location

### Month view legend

- Live forecast vs climate estimate swatches
- 🟢 = green hourly slot

---

## Persistence and browser storage

| Key | Content |
|-----|---------|
| `nuptial-radar-location` | `{ lat, lon, name }` — saved **home** place (not updated by nearby hops) |
| `nuptial-radar-nearby-scan` | Nearby town comparison (peaks + deltas); TTL ~18h |
| `nuptial-radar-algorithm` | Forced to `forest-v1` on load (legacy hybrid IDs rewritten) |
| `nuptial-radar-theme` | Forced to `dark` on load (light preference cleared) |
| `nuptial-radar-simple` | `true` or `false` (default **true** if unset) |
| `nuptial-radar-hourly-anchor` | `now` (default) or `midnight` |
| `nuptial-radar-species` | Genus id (e.g. `camponotus`) or unset = All species |

Supabase auth session is managed by `@supabase/supabase-js` (not a custom localStorage key). Sightings live in Postgres.

---

## Build, deployment, and configuration

### Vite configuration (`vite.config.ts`)

- Dev server port **5173** (falls back if busy)

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_SUPABASE_URL` | For sightings | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | For sightings | Supabase anon/public key |

Copy `.env.example` → `.env` for local dev. On **Vercel**, add the same variables under Project Settings → Environment Variables and redeploy.

Open-Meteo weather APIs remain keyless.

### Production build

```bash
npm run build
```

Output:

- `dist/index.html`
- `dist/assets/*.js`, `*.css`
- `dist/models/*.json`

Deploy via **Vercel** (connected GitHub repo) or any static host. No Node server required at runtime.

---

## Known limitations

1. **16-day hourly cap** — Open-Meteo free forecast API limits hourly data to 16 days. Month view fills remaining days with climate **daily** estimates only.
2. **Sightings need Supabase** — Without env vars, logging is disabled. With anonymous auth, data is tied to the browser session unless you add full user accounts later.
3. **localStorage size** — N/A for sightings (Postgres). Location/algorithm prefs still use localStorage.
4. **Archive API** — Historical weather for old sightings depends on Open-Meteo archive availability and may fail for very recent or future-dated entries.
5. **IP geolocation** — Approximate only; third-party service (ipwho.is) may rate-limit or block some networks.
6. **GPS** — Requires HTTPS (or localhost) for reliable browser geolocation.
7. **Model geography** — RF models are global; local calibration helps but does not replace region-specific training data.

---

## Development history

Work on this repository proceeded in roughly this order:

| Phase | What was built |
|-------|----------------|
| **Initial web app** | Vite + TypeScript recreation of nuptialflight; 7-day forecast; hourly charts; location search + GPS; bundled RF models |
| **Location resilience** | IP fallback (ipwho.is), location picker when GPS denied, non-HTTPS hints |
| **Forecast views** | 24-hour strip, 7-day cards, month calendar; view switcher tabs |
| **Month extension** | Climate API fill for days 17+ of the calendar month; estimate badges |
| **Best Day logic** | Badge only on best day among those with a green hourly slot; hidden if none |
| **Algorithm system** | Pluggable `FlightAlgorithm` interface; registry with localStorage; floating 🌲/📖 switcher |
| **Hybrid v2** | Literature scoring module, bibliography, RF + literature fusion |
| **Sightings + SQLite** | sql.js database, sighting modal, weather snapshot on log, local calibration in scoring |
| **sql.js fix** | Correct Vite import path for wasm build (fixes white screen on load) |
| **Supabase migration** | Replaced sql.js with Supabase Postgres, anonymous auth, RLS, env-based config |
| **Display preferences** | Light/dark toggle and compact simple layout (mobile + desktop), persisted in localStorage; **default dark + simple** |
| **Simple layout polish** | Removed forced full-viewport height; enlarged day cards and hourly chart; added 11 AM / day / 7 PM score row in compact hourly panel; **all top-right controls stay visible** in compact mode (%/emoji, algorithm, sightings) |
| **Scoring parity fixes** | Open-Meteo local-time → UTC `dt`; truncate percentages; Forest v1 skips calibration; day cards use **daily RF model** (not peak hourly); Forest v1 hourly chart uses direct `nuptialHourlyPercentageModel`; hourly chart uses absolute % scale |
| **Hourly anchor toggle** | 🕛 full day vs ⏱ from-now (nuptialflight-style 24 slots); default **from now** |
| **Open-Meteo only** | Removed OpenWeatherMap integration (paid One Call subscription); forecasts always from Open-Meteo |
| **Scoring parity (timing + MSL)** | All-species path is raw RF again; RF uses `pressure_msl`; daily enriched from hourly; genus timing is soft/peak-preserving; default hourly anchor = from now; Hybrid more RF-weighted |
| **Green-slot species tips** | 🐜 icon above every green hour; hover lists top local genera for that slot |
| **Seasonal flight ramps** | Genus seasons use DOY peak + ramp/fade; off-season near-zero; tips omit out-of-season genera |
| **Nearby towns scan** | Same-state places &lt;25 mi; ~18h cache; peak % vs home; tap to switch location |
| **Nearby top-left dropdown** | Always-visible 📍 Nearby control; green notify badge only when a town beats home; auto-init on open when cache stale |
| **Nearby scan fix** | Replaced broken Open-Meteo reverse with BigDataCloud; scan patches nearby chrome only (does not rebuild radar until a town is clicked) |
| **Nearby fixed home** | Starting location stays the nearby origin; town taps are previews; ⌂ returns home; saved location not overwritten by hops |
| **Biology insights toggle** | 🧬 display overlay: RF tree confidence, activity band, rain/window — does not change scores; removed duplicate Biology v3 algorithm |
| **Biology insights fused** | Removed 🧬 button; insights always shown in full (non-compact) day detail / 24h outlook |
| **Geocoding query normalization** | Expands place prefixes (`ft`/`st`/`mt`/`pt`), US state/territory suffixes (`USVI`, `PR`, `VI`, state abbreviations), and USVI island names; uses Open-Meteo `countryCode` when helpful |
| **Green threshold 55%** | Lowered from 60% so tropical forecasts (e.g. USVI) with RF scores in the high 50s show green day/hour windows |
| **Species-aware scoring** | Genus catalog + rain/month/hour timing layer; top-bar autocomplete; best-windows panel; in-app ℹ docs |
| **Species geographic filter** | Dropdown / badges only show genera native or established (incl. invasive) at forecast country/state |
| **Full-width top toolbar** | Floating controls are one large top bar with larger buttons (no two-row wrap) |
| **Lock Forest + dark** | Removed 🌲/📖 model switcher and light-mode toggle; production is Forest v1 + eternal dark |

### Git commits (as of initial documentation)

- `32d14e7` — Add Nuptial Radar web app for ant nuptial flight forecasting
- `56622f1` — Data entry added (SQLite sightings and calibration)

---

## Attribution and license

### nuptialflight

Prediction models (`final_model.json`, `hour_model.json`) and core scoring logic derive from [bradrushworth/nuptialflight](https://github.com/bradrushworth/nuptialflight), licensed under **GPL-3.0**.

### Open-Meteo

Weather, geocoding, climate, and archive data from [Open-Meteo](https://open-meteo.com/).

### Literature

Hybrid v2 parameters cite published ant flight studies; full references are in `src/algorithms/references.ts` (Boomsma & Leusink 1981, Depa 2006, Sobczak et al. 2017, Dunn et al. 2007, Messer et al. 2009, Wilson 1955, and the nuptialflight dataset paper).

### Nuptial Radar

Application code in this repository is part of the Nuptial Radar project: https://github.com/braxtonwilliams/NuptialRadar

When distributing builds that include the nuptialflight models, comply with **GPL-3.0** obligations for the model-derived portions of the codebase.

---

*Last updated to reflect the Supabase sightings backend.*
