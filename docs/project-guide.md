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
- **Optional literature-based scoring** (hybrid v2 algorithm)
- **User-logged sightings** stored in **Supabase Postgres** (via anonymous auth) that nudge probabilities toward conditions where flights were actually observed nearby

The app is a static front-end deployed on Vercel. Weather is fetched from public APIs, models are bundled as static JSON, preferences stay in `localStorage`, and sightings sync to Supabase when configured.

---

## Goals and design decisions

### Recreate nuptialflight as a website

The original [nuptialflight](https://github.com/bradrushworth/nuptialflight) mobile app focuses heavily on **today’s** flight probability. Nuptial Radar expands that into a **multi-day planning tool** with 24-hour, 7-day, and (when conditions warrant) full-month views.

### Open-Meteo instead of OpenWeatherMap

The original app uses OpenWeatherMap. Nuptial Radar uses [Open-Meteo](https://open-meteo.com/) so the site works with zero API keys or account setup. Weather fields are mapped to the same model inputs the nuptialflight forests expect (temperature, humidity, wind, pressure, dew point, precipitation probability, etc.).

### Swappable algorithms without breaking production

The default **Forest v1** algorithm wraps the original nuptialflight scoring logic unchanged. A second **Hybrid v2** algorithm blends those forests with published weather triggers from ant flight literature. Users switch models via a header button; the choice persists in `localStorage`.

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
│   ├── style.css                  # All styles (dark/light via prefers-color-scheme)
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
| `algorithms/scoring.ts` | Single entry point for all probability scores; applies local calibration last |
| `forecast-views.ts` | Builds `DayForecast` objects, month calendar cells, 24h strip data |
| `weather.ts` | Fetches 16-day hourly forecast, climate fill for month view, archive weather for past sightings |
| `db/*` | Supabase client, sightings CRUD, calibration cache |
| `sightings-ui.ts` | Modal form for logging/deleting sightings |

---

## User-facing features

### Multi-range forecast

- **24 Hour** — Compact color strip for the next 24 hours; highlights green windows (≥60%)
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
- Color scale: red &lt;50%, amber 50–59%, green ≥60%
- Emoji ladder: 👎 🤏 🤞 🐜👌 🐜👍 🐜💪 🐜🫶

### Best Day badge

On the 7-day view, **Best day** appears only on the day with the highest daily percentage **among days that have at least one green hourly slot**. If no day has a green hourly window in the visible week, the badge is hidden entirely.

### Green hourly indicator

Days with any hourly slot ≥60% show a 🟢 on day cards and month cells.

### Algorithm switcher

Floating **🌲** (Forest v1) / **📖** (Hybrid v2) button cycles prediction models. A brief toast confirms the active model name.

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

Main forecast location uses city search or IP approximate only (no browser GPS).

---

## Location and geocoding

### Search

`searchLocations()` calls the Open-Meteo Geocoding API with debounced input (300 ms). Results show city, region, and country.

### Reverse geocode

`reverseGeocode()` resolves a human-readable place name from coordinates.

### IP approximate location

`fetchApproximateLocation()` calls `https://ipwho.is/` for a network-based estimate.

### Hints

The location picker offers city search or approximate location from your network.

### Saved location

Key: `nuptial-radar-location` — JSON `{ lat, lon, name }`.

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

Open-Meteo fields are converted into the structures expected by nuptialflight models (`DailyWeather`, `HourlyWeather`). Wind is requested in m/s to match model training units.

---

## Forecast views

### 24-hour glance

`getNext24HourSlots()` filters hourly data from now to +24 h. The UI renders:

- A color strip (one block per hour)
- Summary line (green window count, peak % and time)
- Inline legend for red / amber / green

### 7-day outlook

`buildDayForecasts()` produces `DayForecast[]` for live daily data plus extended climate days. Each day includes:

- Daily percentage (from active algorithm + local calibration)
- Peak hourly percentage that day (for month calendar coloring)
- `hasGreenSlot` — whether any hourly score that day ≥60%
- Size-class percentages and flight text

### Month calendar

`buildMonthCalendar()` lays out weeks for the current local month:

- **Live forecast** cells — from hourly/daily API data
- **Climate estimate** cells — extended daily only
- **🟢** — day has a green hourly slot (live days only)
- Clicking a cell selects that day for the detail panel

The Month tab is **hidden** unless `hasGreenTimeSlot()` is true for the loaded hourly scores (at least one ≥60% slot exists in the live forecast).

---

## Prediction system

All scoring flows through `src/algorithms/scoring.ts`, which:

1. Calls the **active algorithm** from the registry
2. Applies **local calibration** from logged sightings (if any)

### Confidence thresholds

| Threshold | Value | Meaning |
|-----------|-------|---------|
| Green | ≥ 60% | Flight likely |
| Amber | ≥ 50% | Flight possible |
| Below amber | &lt; 50% | Flight unlikely |

### Forest v1 (production default)

**ID:** `forest-v1`  
**Icon:** 🌲  
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

### Hybrid v2 (literature + RF)

**ID:** `hybrid-literature-v2`  
**Icon:** 📖  
**File:** `nuptials-hybrid-v2.ts`

Combines RF scores with **literature-derived suitability** from `literature-scoring.ts`:

```
p_v2 = clamp( w_rf × p_rf + w_lit × p_lit + w_cross × p_rf × p_lit )
```

**Daily weights:** RF 0.52, literature 0.38, cross-term 0.10  
**Hourly weights:** RF 0.48, literature 0.42, cross-term 0.10

Same hard gates as v1 before fusion.

**Literature terms** (see `references.ts` for bibliography):

| Factor | Basis |
|--------|--------|
| Temperature | Boomsma 1981, Sobczak 2017 — trapezoid + Gaussian around ~22 °C |
| Humidity | Boomsma 1981, Depa 2006 — humid days favour flight |
| Wind / gust | Sobczak 2017 — calm air; caps match nuptialflight gates |
| Dew-point depression | Moist air indicator |
| Rain during hour | Active rain suppresses flight |
| Antecedent rain | Wilson 1955, Messor 2009 — boost after moderate rain + clearing |
| Diurnal hours | Late morning and late afternoon peaks |
| Cloud cover | Partly cloudy to overcast often reported |
| Pressure | Weak effect; avoid storm lows |
| Seasonal gate | Hemisphere-aware day-of-year from Dunn 2007 / nuptialflight phenology |

### Species size hints

Separate from the RF/hybrid score, `sizeSeasonalPercentages()` applies **monthly multipliers** per size class (small / medium / large queens) based on hemisphere tables in `nuptials.ts`. These adjust display percentages for “which size queen is most likely today” — they do not change the core flight probability.

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
**Applied in:** `algorithms/scoring.ts` (after base algorithm, for every hourly and daily score)

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
- **Dark** and **light** themes via manual toggle (`data-theme` on `<html>`)
- **Simple / compact mode** via toggle (`data-simple="true"`) — tighter grids, smaller type, hides non-essential sections so forecasts fit on one screen
- Radial gradient background accents

### Floating controls (fixed top-right)

- **☀️ / 🌙** — toggle light and dark mode (saved to `localStorage`; first visit follows system preference)
- **⊟ / ⊞** — compact **simple layout** (denser spacing, hides legend/footer/size breakdown, smaller cards — laptop and mobile)
- **% / 🐜** — toggle numeric vs emoji display
- **🌲 / 📖** — cycle prediction algorithm
- **📝** — open sighting modal (badge shows record count)

On mobile, controls wrap in a full-width bar under the safe area.

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
| `nuptial-radar-location` | `{ lat, lon, name }` — last selected place |
| `nuptial-radar-algorithm` | Active algorithm ID (`forest-v1` or `hybrid-literature-v2`) |
| `nuptial-radar-theme` | `light` or `dark` |
| `nuptial-radar-simple` | `true` when compact layout is enabled |

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
| **Display preferences** | Light/dark toggle and compact simple layout (mobile + desktop), persisted in localStorage |

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
