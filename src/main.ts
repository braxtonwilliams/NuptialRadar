import './style.css';
import { ensureModelsLoaded } from './forest-model';
import {
  findHourAtLocalTime,
  getBgColor,
  getColor,
  getEmoji,
  percentageToInt,
} from './nuptials';
import {
  getGreenThreshold,
  getLocalCalibrationSummary,
  scoreHourly,
  scoreHourlyProbability,
} from './algorithms/scoring';
import {
  cycleAlgorithm,
  getActiveAlgorithm,
  getAlgorithmIcon,
  loadSavedAlgorithmId,
} from './algorithms/registry';
import {
  buildDayForecasts,
  buildMonthCalendar,
  computeHourlyScores,
  getNext24HourSlots,
  hasGreenTimeSlot,
  type ForecastView,
} from './forecast-views';
import type { DayForecast, GeocodeResult, WeatherData } from './types';
import { FORECAST_DAY_LIMIT } from './types';
import {
  fetchApproximateLocation,
  fetchWeather,
  geolocationHint,
  getCurrentPosition,
  getHourlyForDay,
  reverseGeocode,
  searchLocations,
} from './weather';
import { initSupabase } from './db/supabase';
import { refreshSightingsCache } from './db/sightings';
import {
  bindSightingsModal,
  openSightingsModal,
  renderCalibrationNote,
  renderSightingsButton,
  renderSightingsModal,
} from './sightings-ui';

const STORAGE_KEY = 'nuptial-radar-location';

interface SavedLocation {
  lat: number;
  lon: number;
  name: string;
}

let weather: WeatherData | null = null;
let dailyForecasts: DayForecast[] = [];
let extendedForecasts: DayForecast[] = [];
let dailyPercentages: number[] = [];
let extendedPercentages: number[] = [];
let hourlyScores: number[] = [];
let selectedDay = 0;
let selectedExtendedIndex: number | null = null;
let forecastView: ForecastView = '7d';
let showPercentages = false;
let algorithmToast: string | null = null;
let algorithmToastTimer: ReturnType<typeof setTimeout> | null = null;
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

const app = document.querySelector<HTMLDivElement>('#app')!;

function rebuildForecasts(): void {
  if (!weather) return;
  hourlyScores = computeHourlyScores(weather);
  const built = buildDayForecasts(weather, hourlyScores);
  dailyForecasts = built.dailyForecasts;
  extendedForecasts = built.extendedForecasts;
  dailyPercentages = built.dailyPercentages;
  extendedPercentages = built.extendedPercentages;

  if (forecastView === 'month' && !hasGreenTimeSlot(hourlyScores)) {
    forecastView = '7d';
  }
}

function getActiveDay(): DayForecast | null {
  if (selectedExtendedIndex != null) {
    return extendedForecasts[selectedExtendedIndex] ?? null;
  }
  return dailyForecasts[selectedDay] ?? null;
}

function selectForecastDay(index: number): void {
  selectedDay = index;
  selectedExtendedIndex = null;
}

function selectExtendedDay(index: number): void {
  selectedExtendedIndex = index;
  selectedDay = -1;
}

function showMonthTab(): boolean {
  return hasGreenTimeSlot(hourlyScores);
}

function weekForecasts(): DayForecast[] {
  return dailyForecasts.slice(0, 7);
}

function getBestDayIndex(days: DayForecast[]): number | null {
  let best: number | null = null;
  let bestPct = -1;
  days.forEach((d, i) => {
    if (!d.hasGreenSlot) return;
    if (d.percentage > bestPct) {
      bestPct = d.percentage;
      best = i;
    }
  });
  return best;
}

function weekHasGreenSlot(days: DayForecast[]): boolean {
  return days.some((d) => d.hasGreenSlot);
}

function renderHourlyChart(dayIndex: number): string {
  if (!weather) return '';
  const { hourly } = getHourlyForDay(weather, dayIndex);
  if (hourly.length === 0) return '';

  const scores = scoreHourly(weather.lat, weather.lon, hourly, weather.timezoneOffset);
  const maxScore = Math.max(...scores, 1);

  const bars = hourly
    .map((h, i) => {
      const local = new Date((h.dt + weather!.timezoneOffset) * 1000);
      const hour = local.toLocaleTimeString(undefined, { hour: 'numeric', hour12: true, timeZone: 'UTC' });
      const pct = scores[i];
      const height = Math.max(4, (pct / maxScore) * 100);
      const color = getColor(pct);
      const title = `${hour}: ${pct}% (${h.temp.toFixed(1)}°C, ${h.windSpeed.toFixed(1)} m/s wind)`;
      return `
        <div class="hour-bar" title="${title}">
          <div class="hour-bar-fill" style="height:${height}%;background:${color}"></div>
          <span class="hour-label">${local.getUTCHours() % 12 || 12}${local.getUTCHours() >= 12 ? 'p' : 'a'}</span>
        </div>`;
    })
    .join('');

  return `<div class="hourly-chart">${bars}</div>`;
}

function renderWeatherGrid(day: DayForecast): string {
  const w = day.weather;
  const items = [
    ['Temp (day)', `${w.temp.day.toFixed(1)}°C`],
    ['Min / Max', `${w.temp.min.toFixed(1)} / ${w.temp.max.toFixed(1)}°C`],
    ['Dew Point', `${w.dewPoint.toFixed(1)}°C`],
    ['Humidity', `${w.humidity.toFixed(0)}%`],
    ['Wind', `${w.windSpeed.toFixed(1)} m/s`],
    ['Gusts', `${w.windGust.toFixed(1)} m/s`],
    ['Pressure', `${w.pressure.toFixed(0)} hPa`],
    ['Clouds', `${w.clouds.toFixed(0)}%`],
    ['Rain chance', `${(w.pop * 100).toFixed(0)}%`],
    ['UV Index', `${w.uvi.toFixed(1)}`],
  ];

  return `
    <div class="weather-grid">
      ${items
        .map(
          ([label, value]) => `
        <div class="weather-stat">
          <span class="stat-label">${label}</span>
          <span class="stat-value">${value}</span>
        </div>`,
        )
        .join('')}
    </div>`;
}

function renderSizeBreakdown(day: DayForecast): string {
  const sizes = [
    { key: 'small', label: 'Small queens', icon: '🐜' },
    { key: 'medium', label: 'Medium queens', icon: '🐜🐜' },
    { key: 'large', label: 'Large queens', icon: '🐜🐜🐜' },
  ] as const;

  return `
    <div class="size-breakdown">
      <h3>Species size likelihood</h3>
      <p class="size-note">Different queen sizes peak in different months for your hemisphere.</p>
      <div class="size-bars">
        ${sizes
          .map(({ key, label }) => {
            const pct = day.sizePercentages[key];
            return `
            <div class="size-row">
              <span class="size-label">${label}</span>
              <div class="size-track">
                <div class="size-fill" style="width:${Math.min(100, pct)}%;background:${getColor(pct)}"></div>
              </div>
              <span class="size-pct">${pct}%</span>
            </div>`;
          })
          .join('')}
      </div>
    </div>`;
}

function renderDayCards(days: DayForecast[]): string {
  const bestDayIdx = getBestDayIndex(days);

  return days
    .map((day, i) => {
      const isBest = bestDayIdx !== null && i === bestDayIdx && day.hasGreenSlot;
      const isSelected =
        !day.isEstimate && day.index === selectedDay && selectedExtendedIndex == null;
      const greenBadge = day.hasGreenSlot
        ? '<span class="day-green-dot" title="Green hourly window">🟢</span>'
        : '';
      return `
        <button
          class="day-card ${isSelected ? 'selected' : ''} ${isBest ? 'best-day' : ''} ${day.hasGreenSlot ? 'has-green-slot' : ''}"
          data-day="${day.index}"
          style="--card-accent: ${getColor(day.percentage)}; --card-bg: ${getBgColor(day.percentage)}"
        >
          ${isBest ? '<span class="best-badge">Best day</span>' : ''}
          ${greenBadge}
          <span class="day-weekday">${day.weekday}</span>
          <span class="day-label">${day.label}</span>
          <span class="day-emoji">${showPercentages ? `${day.percentage}%` : getEmoji(day.percentage)}</span>
          <span class="day-temp">${day.weather.temp.day.toFixed(0)}°C</span>
          <span class="day-desc">${day.weather.description}</span>
        </button>`;
    })
    .join('');
}

function renderAlgorithmButton(): string {
  const algo = getActiveAlgorithm();
  const icon = getAlgorithmIcon(algo.id);
  const isHybrid = algo.id === 'hybrid-literature-v2';
  return `
    <button
      id="algorithm-switch"
      class="btn-ghost algorithm-btn ${isHybrid ? 'algorithm-btn-alt' : ''}"
      type="button"
      title="Prediction model: ${algo.name}. Click to switch."
      aria-label="Switch prediction model (${algo.name})"
    >${icon}</button>`;
}

function showAlgorithmToast(name: string): void {
  algorithmToast = `Model: ${name}`;
  if (algorithmToastTimer) clearTimeout(algorithmToastTimer);
  algorithmToastTimer = setTimeout(() => {
    algorithmToast = null;
    render();
  }, 2500);
}

function switchAlgorithm(): void {
  const next = cycleAlgorithm();
  if (weather) rebuildForecasts();
  showAlgorithmToast(next.name);
  render();
}

function renderViewSwitcher(): string {
  const monthVisible = showMonthTab();
  return `
    <div class="view-switcher" role="tablist" aria-label="Forecast range">
      <button class="view-tab ${forecastView === '24h' ? 'active' : ''}" data-view="24h" role="tab" aria-selected="${forecastView === '24h'}">
        24 Hour
      </button>
      <button class="view-tab ${forecastView === '7d' ? 'active' : ''}" data-view="7d" role="tab" aria-selected="${forecastView === '7d'}">
        7 Day
      </button>
      ${
        monthVisible
          ? `<button class="view-tab ${forecastView === 'month' ? 'active' : ''}" data-view="month" role="tab" aria-selected="${forecastView === 'month'}">
        Month
      </button>`
          : ''
      }
    </div>`;
}

function render24HourView(): string {
  if (!weather) return '';
  const slots = getNext24HourSlots(weather, hourlyScores);
  const greenThreshold = getGreenThreshold();
  const greenSlots = slots.filter((s) => s.percentage >= greenThreshold);
  const peak = slots.reduce((max, s) => Math.max(max, s.percentage), 0);
  const peakSlot = slots.find((s) => s.percentage === peak);

  const summaryLine =
    greenSlots.length > 0
      ? `${greenSlots.length} green window${greenSlots.length === 1 ? '' : 's'} · peak ${peak}%${peakSlot ? ` at ${peakSlot.timeLabel}` : ''}`
      : peak > 0
        ? `Peak ${peak}%${peakSlot ? ` at ${peakSlot.timeLabel}` : ''} · no green windows`
        : 'No flight windows';

  const strip = slots
    .map((slot) => {
      const isGreen = slot.percentage >= greenThreshold;
      const title = `${slot.timeLabel}: ${slot.percentage}%`;
      return `<div class="glance-block ${isGreen ? 'glance-green' : ''}" style="background:${getColor(slot.percentage)}" title="${title}"></div>`;
    })
    .join('');

  const labels = slots
    .filter((_, i) => i % 3 === 0)
    .map((slot) => `<span>${slot.timeLabel.replace(':00', '').replace(' ', '')}</span>`)
    .join('');

  const greenTimes = greenSlots.map((s) => s.timeLabel).join(', ');

  return `
    <section class="forecast-view glance-24h">
      <div class="glance-header" style="--accent: ${getColor(peak)}">
        <h2>Next 24 Hours</h2>
        <p class="glance-summary">${summaryLine}</p>
        ${greenTimes ? `<p class="glance-green-times">🟢 ${greenTimes}</p>` : ''}
      </div>
      <div class="glance-strip-wrap">
        <div class="glance-strip">${strip || '<p class="empty-note">No data</p>'}</div>
        <div class="glance-labels">${labels}</div>
      </div>
      <p class="glance-legend-inline"><span class="leg-swatch" style="background:#b71c1c"></span> low <span class="leg-swatch" style="background:#e65100"></span> possible <span class="leg-swatch" style="background:#2e7d32"></span> likely (≥60%)</p>
    </section>`;
}

function render7DayView(): string {
  const days = weekForecasts();
  const weekPcts = dailyPercentages.slice(0, 7);
  const weekHigh = Math.max(...weekPcts, 0);
  const weekHighDay = days.find((d) => d.percentage === weekHigh);
  const hasGreen = weekHasGreenSlot(days);
  const bestGreenIdx = getBestDayIndex(days);
  const bestGreenDay = bestGreenIdx != null ? days[bestGreenIdx] : null;

  const summaryText = hasGreen
    ? bestGreenDay
      ? `Green flight windows this week — best day is <strong>${bestGreenDay.label}</strong> (${bestGreenDay.percentage}% daily, 🟢 hourly).`
      : `Green flight windows expected this week. Peak daily chance <strong>${weekHigh}%</strong>${weekHighDay ? ` on ${weekHighDay.label}` : ''}.`
    : weekHigh >= 50
      ? `Some activity possible, but no green hourly windows. Peak daily chance <strong>${weekHigh}%</strong>${weekHighDay ? ` on ${weekHighDay.label}` : ''}.`
      : `Low flight activity this week — no green hourly windows. Peak daily chance <strong>${weekHigh}%</strong>.`;

  return `
    <section class="forecast-view">
      <div class="summary-card" style="--accent: ${hasGreen ? '#2e7d32' : getColor(weekHigh)}">
        <h2>7-Day Outlook</h2>
        <p class="summary-text">${summaryText}</p>
      </div>

      <section class="week-forecast">
        <h2 class="section-title">Daily forecast</h2>
        <div class="day-cards">${renderDayCards(days)}</div>
      </section>

      ${renderDayDetail()}
    </section>`;
}

function renderMonthView(): string {
  if (!weather) return '';
  const { monthLabel, weeks, forecastDays, estimateDays } = buildMonthCalendar(
    weather,
    hourlyScores,
    dailyPercentages,
    extendedPercentages,
  );
  const greenDays = weeks.flat().filter((c) => c.hasGreenSlot && c.inMonth).length;

  const grid = weeks
    .map(
      (week) => `
      <div class="month-week">
        ${week
          .map((cell) => {
            if (!cell.inMonth) return '<div class="month-cell empty"></div>';
            const pct = cell.peakPercentage;
            const dataAttrs =
              cell.dailyIndex != null
                ? `data-day="${cell.dailyIndex}"`
                : cell.extendedIndex != null
                  ? `data-extended="${cell.extendedIndex}"`
                  : '';
            return `
              <button
                class="month-cell ${cell.isToday ? 'today' : ''} ${cell.hasGreenSlot ? 'has-green' : ''} ${cell.isEstimate ? 'is-estimate' : 'is-forecast'} ${cell.hasForecast ? 'has-forecast' : 'no-forecast'} ${cell.dailyIndex === selectedDay || cell.extendedIndex === selectedExtendedIndex ? 'selected' : ''}"
                ${dataAttrs}
                style="${pct != null ? `--cell-accent: ${getColor(pct)}` : ''}"
                ${!cell.hasForecast ? 'disabled' : ''}
              >
                <span class="month-day-num">${cell.day}</span>
                ${
                  pct != null
                    ? `<span class="month-day-pct">${showPercentages ? `${pct}%` : getEmoji(pct)}</span>`
                    : '<span class="month-day-pct muted">—</span>'
                }
                ${cell.hasGreenSlot ? '<span class="month-green-dot" title="Green hourly window"></span>' : ''}
                ${cell.isEstimate ? '<span class="month-est-badge" title="Climate average estimate">~</span>' : ''}
              </button>`;
          })
          .join('')}
      </div>`,
    )
    .join('');

  return `
    <section class="forecast-view">
      <div class="summary-card" style="--accent: ${greenDays > 0 ? '#2e7d32' : getColor(Math.max(...dailyPercentages, 0))}">
        <h2>${monthLabel}</h2>
        <p class="summary-text">
          ${
            greenDays > 0
              ? `<strong>${greenDays}</strong> day${greenDays === 1 ? '' : 's'} with a green hourly window (≥60%).`
              : 'No green hourly windows in the live forecast this month.'
          }
          <span class="summary-sub">
            <strong>${forecastDays}</strong> live days (hourly, up to ${FORECAST_DAY_LIMIT}-day API limit)${estimateDays > 0 ? ` · <strong>${estimateDays}</strong> climate-estimate days for the rest of the month` : ''}.
          </span>
        </p>
      </div>

      <div class="month-legend-row">
        <span><span class="month-legend-swatch forecast"></span> Live forecast</span>
        <span><span class="month-legend-swatch estimate"></span> Climate estimate</span>
        <span>🟢 Green hourly slot</span>
      </div>

      <div class="month-calendar">
        <div class="month-weekdays">
          ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<span>${d}</span>`).join('')}
        </div>
        ${grid}
      </div>

      ${getActiveDay() ? renderDayDetail() : ''}
    </section>`;
}

function renderDayDetail(): string {
  if (!weather) return '';
  const day = getActiveDay();
  if (!day) return '';

  const dayIndex = selectedExtendedIndex == null ? selectedDay : -1;
  const isEstimate = day.isEstimate === true;

  const diurnalHour =
    !isEstimate && dayIndex >= 0
      ? findHourAtLocalTime(weather.hourly, weather.timezoneOffset, '11AM')
      : null;
  const nocturnalHour =
    !isEstimate && dayIndex >= 0
      ? findHourAtLocalTime(weather.hourly, weather.timezoneOffset, '7PM')
      : null;
  const diurnalPct =
    diurnalHour && !isEstimate
      ? percentageToInt(
          scoreHourlyProbability(weather.lat, weather.lon, diurnalHour, weather.timezoneOffset),
        )
      : 0;
  const nocturnalPct =
    nocturnalHour && !isEstimate
      ? percentageToInt(
          scoreHourlyProbability(weather.lat, weather.lon, nocturnalHour, weather.timezoneOffset),
        )
      : 0;

  return `
    <section class="day-detail">
      <div class="detail-header">
        <h2>${day.label === 'Today' ? 'Today' : day.label + ' (' + day.weekday + ')'}</h2>
        ${isEstimate ? '<p class="estimate-badge">Climate average · daily estimate only</p>' : ''}
        ${day.hasGreenSlot ? '<p class="green-slot-badge">🟢 Has a green hourly window</p>' : ''}
        <p class="flight-status" style="color: ${getColor(day.percentage)}">${day.flightText}</p>
      </div>

      ${
        !isEstimate
          ? `
      <div class="today-scores">
        <div class="score-box" style="--accent: ${getColor(diurnalPct)}">
          <span class="score-label">11 AM window</span>
          <span class="score-value">${showPercentages ? `${diurnalPct}%` : getEmoji(diurnalPct)}</span>
        </div>
        <div class="score-box primary" style="--accent: ${getColor(day.percentage)}">
          <span class="score-label">Day overall</span>
          <span class="score-value">${showPercentages ? `${day.percentage}%` : getEmoji(day.percentage)}</span>
        </div>
        <div class="score-box" style="--accent: ${getColor(nocturnalPct)}">
          <span class="score-label">7 PM window</span>
          <span class="score-value">${showPercentages ? `${nocturnalPct}%` : getEmoji(nocturnalPct)}</span>
        </div>
      </div>

      <div class="detail-panel">
        <h3>Hourly flight probability — ${day.label}</h3>
        ${dayIndex >= 0 ? renderHourlyChart(dayIndex) : ''}
      </div>`
          : `
      <div class="today-scores single">
        <div class="score-box primary" style="--accent: ${getColor(day.percentage)}">
          <span class="score-label">Daily estimate</span>
          <span class="score-value">${showPercentages ? `${day.percentage}%` : getEmoji(day.percentage)}</span>
        </div>
      </div>`
      }

      <div class="detail-panel">
        <h3>Weather conditions</h3>
        <p class="weather-summary">${day.weather.description} · ${day.weather.temp.day.toFixed(1)}°C · ${(day.weather.pop * 100).toFixed(0)}% rain</p>
        ${renderWeatherGrid(day)}
      </div>

      ${renderSizeBreakdown(day)}
    </section>`;
}

function renderForecastContent(): string {
  switch (forecastView) {
    case '24h':
      return render24HourView();
    case 'month':
      return renderMonthView();
    default:
      return render7DayView();
  }
}

function render(): void {
  if (!weather) {
    app.innerHTML = `
      <div class="loading-screen">
        <div class="spinner"></div>
        <p>Loading forecast models…</p>
      </div>`;
    return;
  }

  app.innerHTML = `
    <div class="floating-controls">
      <div class="header-actions">
        <button id="toggle-mode" class="btn-ghost" title="Toggle percentage / emoji display">
          ${showPercentages ? '🐜' : '%'}
        </button>
        ${renderAlgorithmButton()}
        ${renderSightingsButton()}
      </div>
      ${algorithmToast ? `<div class="algorithm-toast" role="status">${algorithmToast}</div>` : ''}
    </div>

    <header class="header">
      <div class="header-top">
        <div class="brand">
          <span class="brand-icon">🪽🐜</span>
          <div>
            <h1>Nuptial Radar</h1>
            <p class="tagline">Ant nuptial flight predictor</p>
          </div>
        </div>
      </div>

      <div class="location-bar">
        <div class="search-wrap">
          <input
            id="location-search"
            type="search"
            placeholder="Search city or use GPS…"
            autocomplete="off"
          />
          <div id="search-results" class="search-results hidden"></div>
        </div>
        <button id="gps-btn" class="btn-icon" title="Use my location">📍</button>
      </div>

      <p class="location-name">${weather.locationName}</p>
      ${renderCalibrationNote(weather.lat, weather.lon, getLocalCalibrationSummary)}
      ${renderViewSwitcher()}
    </header>

    <main class="main">
      ${renderForecastContent()}

      <section class="legend">
        <h3>Confidence scale</h3>
        <p class="legend-emojis">👎 🤏 🤞 🐜👌 🐜👍 🐜💪 🐜🫶</p>
        <p class="legend-note">
          Based on the
          <a href="https://github.com/bradrushworth/nuptialflight" target="_blank" rel="noopener">nuptialflight</a>
          random-forest models. Red &lt;50%, amber 50–59%, green ≥60%.
          Log sightings with 📝 to calibrate forecasts using your local flight history.
        </p>
      </section>
    </main>

    <footer class="footer">
      <p>Weather from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> · Models from nuptialflight (GPL-3.0)</p>
    </footer>
    ${renderSightingsModal()}
  `;

  bindEvents();
  bindSightingsModal();
}

function bindEvents(): void {
  document.querySelectorAll('.view-tab').forEach((el) => {
    el.addEventListener('click', () => {
      forecastView = (el as HTMLElement).dataset.view as ForecastView;
      render();
    });
  });

  document.querySelectorAll('.day-card').forEach((el) => {
    el.addEventListener('click', () => {
      selectForecastDay(Number((el as HTMLElement).dataset.day));
      render();
    });
  });

  document.querySelectorAll('.month-cell.has-forecast').forEach((el) => {
    el.addEventListener('click', () => {
      const node = el as HTMLElement;
      if (node.dataset.extended != null) {
        selectExtendedDay(Number(node.dataset.extended));
      } else if (node.dataset.day != null) {
        selectForecastDay(Number(node.dataset.day));
      }
      render();
    });
  });

  document.getElementById('algorithm-switch')?.addEventListener('click', () => {
    switchAlgorithm();
  });

  document.getElementById('toggle-mode')?.addEventListener('click', () => {
    showPercentages = !showPercentages;
    render();
  });

  document.getElementById('sightings-log-btn')?.addEventListener('click', () => {
    if (!weather) return;
    openSightingsModal(
      { lat: weather.lat, lon: weather.lon, locationLabel: weather.locationName },
      () => {
        if (weather) rebuildForecasts();
        render();
      },
    );
    render();
  });

  document.getElementById('gps-btn')?.addEventListener('click', () => {
    loadFromGps(true);
  });

  const searchInput = document.getElementById('location-search') as HTMLInputElement;
  searchInput?.addEventListener('input', () => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => handleSearch(searchInput.value), 300);
  });

  searchInput?.addEventListener('focus', () => {
    if (searchInput.value.trim()) handleSearch(searchInput.value);
  });

  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.search-wrap')) {
        document.getElementById('search-results')?.classList.add('hidden');
      }
    },
    { once: true },
  );
}

async function handleSearch(query: string): Promise<void> {
  const resultsEl = document.getElementById('search-results');
  if (!resultsEl) return;

  if (!query.trim()) {
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = '';
    return;
  }

  try {
    const results = await searchLocations(query);
    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="search-empty">No locations found</div>';
    } else {
      resultsEl.innerHTML = results
        .map(
          (r) => `
        <button class="search-result" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${escapeAttr(formatLocationName(r))}">
          <strong>${r.name}</strong>
          <span>${[r.admin1, r.country].filter(Boolean).join(', ')}</span>
        </button>`,
        )
        .join('');

      resultsEl.querySelectorAll('.search-result').forEach((btn) => {
        btn.addEventListener('click', () => {
          const el = btn as HTMLElement;
          const lat = Number(el.dataset.lat);
          const lon = Number(el.dataset.lon);
          const name = el.dataset.name ?? '';
          resultsEl.classList.add('hidden');
          loadLocation(lat, lon, name);
        });
      });
    }
    resultsEl.classList.remove('hidden');
  } catch {
    resultsEl.innerHTML = '<div class="search-empty">Search failed</div>';
    resultsEl.classList.remove('hidden');
  }
}

function formatLocationName(r: GeocodeResult): string {
  return [r.name, r.admin1, r.country].filter(Boolean).join(', ');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

function saveLocation(loc: SavedLocation): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
}

function loadSavedLocation(): SavedLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedLocation) : null;
  } catch {
    return null;
  }
}

function showError(message: string): void {
  app.innerHTML = `
    <div class="error-screen">
      <h2>Something went wrong</h2>
      <p>${message}</p>
      <button id="retry-btn" class="btn-primary">Try again</button>
      <button id="pick-location-btn" class="btn-ghost">Choose a location</button>
    </div>`;
  document.getElementById('retry-btn')?.addEventListener('click', () => init());
  document.getElementById('pick-location-btn')?.addEventListener('click', () => showLocationPrompt());
}

function showLocationPrompt(notice?: string): void {
  app.innerHTML = `
    <div class="location-prompt">
      <div class="brand brand-center">
        <span class="brand-icon">🪽🐜</span>
        <div>
          <h1>Nuptial Radar</h1>
          <p class="tagline">Ant nuptial flight predictor</p>
        </div>
      </div>

      ${notice ? `<p class="location-notice">${notice}</p>` : ''}
      <p class="location-hint">${geolocationHint()}</p>

      <div class="prompt-actions">
        <div class="search-wrap search-wrap-prominent">
          <input
            id="prompt-search"
            type="search"
            placeholder="Search for your city…"
            autocomplete="off"
            autofocus
          />
          <div id="prompt-results" class="search-results hidden"></div>
        </div>
        <div class="prompt-buttons">
          <button id="prompt-gps-btn" class="btn-primary">Use precise location</button>
          <button id="prompt-ip-btn" class="btn-ghost">Use approximate location</button>
        </div>
      </div>
    </div>`;

  document.getElementById('prompt-gps-btn')?.addEventListener('click', () => {
    loadFromGps(true);
  });

  document.getElementById('prompt-ip-btn')?.addEventListener('click', () => {
    loadFromApproximate();
  });

  const input = document.getElementById('prompt-search') as HTMLInputElement;
  input?.addEventListener('input', () => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => handlePromptSearch(input.value), 300);
  });
  input?.focus();
}

async function handlePromptSearch(query: string): Promise<void> {
  const resultsEl = document.getElementById('prompt-results');
  if (!resultsEl) return;

  if (!query.trim()) {
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = '';
    return;
  }

  try {
    const results = await searchLocations(query);
    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="search-empty">No locations found</div>';
    } else {
      resultsEl.innerHTML = results
        .map(
          (r) => `
        <button class="search-result" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${escapeAttr(formatLocationName(r))}">
          <strong>${r.name}</strong>
          <span>${[r.admin1, r.country].filter(Boolean).join(', ')}</span>
        </button>`,
        )
        .join('');

      resultsEl.querySelectorAll('.search-result').forEach((btn) => {
        btn.addEventListener('click', () => {
          const el = btn as HTMLElement;
          loadLocation(Number(el.dataset.lat), Number(el.dataset.lon), el.dataset.name);
        });
      });
    }
    resultsEl.classList.remove('hidden');
  } catch {
    resultsEl.innerHTML = '<div class="search-empty">Search failed</div>';
    resultsEl.classList.remove('hidden');
  }
}

function showLoading(message: string): void {
  app.innerHTML = `
    <div class="loading-screen">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>`;
}

async function loadLocation(lat: number, lon: number, name?: string): Promise<void> {
  showLoading('Fetching weather forecast…');
  try {
    await ensureModelsLoaded();
    weather = await fetchWeather(lat, lon, name);
    saveLocation({ lat, lon, name: weather.locationName });
    selectedDay = 0;
    selectedExtendedIndex = null;
    forecastView = '7d';
    rebuildForecasts();
    render();
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Failed to load forecast');
  }
}

function gpsFailureMessage(e: unknown): string {
  if (e instanceof GeolocationPositionError) {
    if (e.code === GeolocationPositionError.PERMISSION_DENIED) {
      return 'Location access was blocked. Search for your city or use approximate location.';
    }
    if (e.code === GeolocationPositionError.TIMEOUT) {
      return 'Location timed out. Search for your city or use approximate location.';
    }
    return 'Could not determine your location. Search for your city or use approximate location.';
  }
  if (e instanceof Error) return e.message;
  return 'Could not get your location. Search for your city or use approximate location.';
}

async function loadFromApproximate(): Promise<void> {
  showLoading('Estimating location from network…');
  const approx = await fetchApproximateLocation();
  if (approx) {
    await loadLocation(approx.lat, approx.lon, approx.name);
    return;
  }
  showLocationPrompt('Could not estimate your location automatically.');
}

async function loadFromGps(fromPrompt = false): Promise<void> {
  showLoading('Getting your location…');
  try {
    const pos = await getCurrentPosition();
    const name = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
    await loadLocation(pos.coords.latitude, pos.coords.longitude, name);
  } catch (e) {
    if (!fromPrompt) {
      const approx = await fetchApproximateLocation();
      if (approx) {
        await loadLocation(approx.lat, approx.lon, `${approx.name} (approx.)`);
        return;
      }
    }
    showLocationPrompt(gpsFailureMessage(e));
  }
}

async function init(): Promise<void> {
  loadSavedAlgorithmId();
  showLoading('Loading prediction models…');
  try {
    await Promise.all([ensureModelsLoaded(), initSupabase()]);
    await refreshSightingsCache();
    const saved = loadSavedLocation();
    if (saved) {
      await loadLocation(saved.lat, saved.lon, saved.name);
      return;
    }

    // Try GPS quietly; fall back to IP estimate, then location picker.
    try {
      const pos = await getCurrentPosition();
      const name = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      await loadLocation(pos.coords.latitude, pos.coords.longitude, name);
      return;
    } catch {
      const approx = await fetchApproximateLocation();
      if (approx) {
        await loadLocation(approx.lat, approx.lon, `${approx.name} (approx.)`);
        return;
      }
    }

    showLocationPrompt();
  } catch {
    showLocationPrompt('Could not load forecast models. Check your connection and try searching for a city.');
  }
}

init();
