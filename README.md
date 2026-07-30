# Nuptial Radar

A web recreation of [nuptialflight](https://github.com/bradrushworth/nuptialflight) — predict when queen ants are likely to fly near you, with a **7-day forecast** as the primary view.

## Features

- **7-day outlook** — color-coded flight probability for each of the next 8 days (today + week ahead)
- **Hourly breakdown** — click any day to see hour-by-hour flight probability
- **Species size hints** — seasonal likelihood for small, medium, and large queen ants
- **Location search** — geocode any city, or use browser GPS
- **Same ML models** — bundled random-forest models from the original app (`final_model.json`, `hour_model.json`)

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Build for production

```bash
npm run build
npm run preview
```

Output goes to `dist/`.

## How it works

1. Fetches weather from [Open-Meteo](https://open-meteo.com/) (free, no API key required)
2. Scores each day and hour using the nuptialflight random-forest models
3. Applies seasonal size-class adjustments based on hemisphere and month

The original app uses OpenWeatherMap; this web version uses Open-Meteo for zero-config deployment. Weather variables are mapped to the same model inputs (temperature, humidity, wind, pressure, dew point, etc.).

## Confidence scale

| Range | Meaning |
|-------|---------|
| &lt; 50% | Unlikely (red) |
| 50–59% | Possible (amber) |
| ≥ 60% | Likely (green) |

Emojis: 👎 🤏 🤞 🐜👌 🐜👍 🐜💪 🐜🫶

## Attribution

- Prediction models and logic from [bradrushworth/nuptialflight](https://github.com/bradrushworth/nuptialflight) (GPL-3.0)
- Weather data from [Open-Meteo](https://open-meteo.com/)

## Documentation

Detailed project documentation lives in **[docs/](./docs/)**:

- [Documentation index](./docs/README.md)
- [Full project guide](./docs/project-guide.md) — architecture, algorithms, database, weather pipeline, UI, and development history
- [Supabase setup](./docs/supabase-setup.md) — database migration and Vercel env vars

## License

GPL-3.0 (models and derived logic from nuptialflight)
