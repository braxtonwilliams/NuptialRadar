import './style.css';
import { ensureModelsLoaded } from './forest-model';
import { getSimpleMode, getTheme, getHourlyAnchor, getBiologyInsights, hourlyAnchorLabel, toggleBiologyInsights, toggleHourlyAnchor, toggleSimpleMode, toggleTheme } from './display-preferences';
import {
  findHourAtLocalTime,
  getEmoji,
  percentageToInt,
} from './nuptials';
import {
  getBiologyInsightsContext,
  getDailyBiologyInsights,
  getGreenThreshold,
  getHourlyBiologyInsights,
  getLocalCalibrationSummary,
  getScoreBgColor,
  getScoreColor,
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
import type { DayForecast, WeatherData } from './types';
import { FORECAST_DAY_LIMIT } from './types';
import {
  fetchApproximateLocation,
  fetchWeather,
  geolocationHint,
  getHourlyWindow,
} from './weather';
import {
  bindLocationSearchInputs,
  initLocationSearch,
  renderLocationSearchBar,
  renderPromptLocationSearch,
} from './location-search-ui';
import { initSupabase } from './db/supabase';
import { refreshSightingsCache } from './db/sightings';
import {
  bindSightingsModal,
  openSightingsModal,
  renderCalibrationNote,
  renderSightingsButton,
  renderSightingsModal,
} from './sightings-ui';
import {
  initSpeciesUi,
  positionSpeciesPopover,
  renderSpeciesControl,
  renderSpeciesInfoModal,
  renderSpeciesOutlook,
  renderSpeciesPopoverPanel,
  renderGreenSlotSpeciesTip,
  hideGreenSpeciesTipFloat,
  setSpeciesForecastContext,
  syncSpeciesToWeatherPlace,
} from './species/species-ui';
import { getSelectedSpecies, loadSavedSpeciesId } from './species/selection';

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

const app = document.querySelector<HTMLDivElement>('#app')!;

function rebuildForecasts(): void {
  if (!weather) return;
  syncSpeciesToWeatherPlace(weather);
  hourlyScores = computeHourlyScores(weather);
  const built = buildDayForecasts(weather, hourlyScores);
  dailyForecasts = built.dailyForecasts;
  extendedForecasts = built.extendedForecasts;
  dailyPercentages = built.dailyPercentages;
  extendedPercentages = built.extendedPercentages;
  setSpeciesForecastContext(weather);

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

function renderHourlyAnchorToggle(compact = false): string {
  const anchor = getHourlyAnchor();
  const label = hourlyAnchorLabel(anchor);
  return `
    <button
      class="btn-ghost hourly-anchor-toggle toggle-hourly-anchor ${compact ? 'hourly-anchor-toggle-compact' : ''} ${anchor === 'now' ? 'btn-active' : ''}"
      type="button"
      title="${anchor === 'now' ? 'Showing 24 hours from now (nuptialflight style). Click for full day from midnight.' : 'Showing full day from midnight. Click for 24 hours from now.'}"
      aria-label="Toggle hourly window: ${label}"
    >
      ${anchor === 'now' ? '⏱' : '🕛'} ${compact ? '' : `<span class="hourly-anchor-label">${label}</span>`}
    </button>`;
}

function renderHourlyChart(dayIndex: number): string {
  if (!weather) return '';
  const anchor = dayIndex === 0 ? getHourlyAnchor() : 'midnight';
  const { hourly, indices } = getHourlyWindow(weather, anchor, {
    dayIndex,
    limit: anchor === 'now' ? 24 : undefined,
  });
  if (hourly.length === 0) return '';

  const greenThreshold = getGreenThreshold();
  const bars = hourly
    .map((h, i) => {
      const local = new Date((h.dt + weather!.timezoneOffset) * 1000);
      const hour = local.toLocaleTimeString(undefined, { hour: 'numeric', hour12: true, timeZone: 'UTC' });
      const idx = indices[i];
      const pct = hourlyScores[idx] ?? 0;
      const displayHeight = Math.max(10, pct);
      const color = scoreColor(pct);
      const isGreen = pct >= greenThreshold;
      const tip = isGreen ? renderGreenSlotSpeciesTip(idx, pct) : '';
      const title = `${hour}: ${pct}% (${h.temp.toFixed(1)}°C, ${h.windSpeed.toFixed(1)} m/s wind)`;
      return `
        <div class="hour-bar${isGreen ? ' hour-bar-green' : ''}" ${tip ? '' : `title="${title}"`}>
          ${tip}
          <div class="hour-bar-fill" style="height:${displayHeight}%;background:${color}" title="${title}"></div>
          <span class="hour-label">${local.getUTCHours() % 12 || 12}${local.getUTCHours() >= 12 ? 'p' : 'a'}</span>
        </div>`;
    })
    .join('');

  return `<div class="hourly-chart">${bars}</div>`;
}

function renderCompactHourlyPanel(): string {
  if (!weather || selectedExtendedIndex != null) return '';
  const dayIndex = selectedDay >= 0 ? selectedDay : 0;
  const day = dailyForecasts[dayIndex];
  if (!day) return '';

  if (day.isEstimate) {
    return `
    <div class="compact-hourly compact-hourly-estimate">
      <p class="compact-hourly-empty">${day.label}: climate estimate only — no hourly breakdown.</p>
    </div>`;
  }

  const diurnalHour = findHourAtLocalTime(weather.hourly, weather.timezoneOffset, '11AM');
  const nocturnalHour = findHourAtLocalTime(weather.hourly, weather.timezoneOffset, '7PM');
  const diurnalIdx = diurnalHour ? weather.hourly.indexOf(diurnalHour) : -1;
  const nocturnalIdx = nocturnalHour ? weather.hourly.indexOf(nocturnalHour) : -1;
  const diurnalPct = diurnalHour
    ? percentageToInt(
        scoreHourlyProbability(
          weather.lat,
          weather.lon,
          diurnalHour,
          weather.timezoneOffset,
          weather,
          diurnalIdx >= 0 ? diurnalIdx : undefined,
        ),
      )
    : 0;
  const nocturnalPct = nocturnalHour
    ? percentageToInt(
        scoreHourlyProbability(
          weather.lat,
          weather.lon,
          nocturnalHour,
          weather.timezoneOffset,
          weather,
          nocturnalIdx >= 0 ? nocturnalIdx : undefined,
        ),
      )
    : 0;

  const chart = renderHourlyChart(dayIndex);
  const status = showPercentages ? `${day.percentage}%` : getEmoji(day.percentage);
  const dayOverallPct = day.dailyModelPercentage ?? day.percentage;
  const fmt = (pct: number) => (showPercentages ? `${pct}%` : getEmoji(pct));

  return `
    <div class="compact-hourly">
      <div class="compact-hourly-head">
        <span class="compact-hourly-title">${day.label} hourly</span>
        <div class="compact-hourly-head-actions">
          ${dayIndex === 0 ? renderHourlyAnchorToggle(true) : ''}
          <span class="compact-hourly-day" style="color:${scoreColor(day.percentage)}">${status}</span>
        </div>
      </div>
      <div class="compact-scores">
        <div class="compact-score" style="--accent:${scoreColor(diurnalPct)}">
          <span class="compact-score-label">11 AM</span>
          <span class="compact-score-value">${fmt(diurnalPct)}</span>
        </div>
        <div class="compact-score compact-score-primary" style="--accent:${scoreColor(dayOverallPct)}">
          <span class="compact-score-label">Day</span>
          <span class="compact-score-value">${fmt(dayOverallPct)}</span>
        </div>
        <div class="compact-score" style="--accent:${scoreColor(nocturnalPct)}">
          <span class="compact-score-label">7 PM</span>
          <span class="compact-score-value">${fmt(nocturnalPct)}</span>
        </div>
      </div>
      ${chart || '<p class="compact-hourly-empty">No hourly data for this day.</p>'}
      ${dayIndex >= 0 ? renderBiologyInsightsPanel(dayIndex, null) : ''}
    </div>`;
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
  const focusSize = getSelectedSpecies()?.sizeClass ?? null;

  return `
    <div class="size-breakdown">
      <h3>Species size likelihood</h3>
      <p class="size-note">Different queen sizes peak in different months for your hemisphere.${
        focusSize
          ? ` Highlighted for <em>${getSelectedSpecies()!.genus}</em> (${focusSize}).`
          : ''
      }</p>
      <div class="size-bars">
        ${sizes
          .map(({ key, label }) => {
            const pct = day.sizePercentages[key];
            const focus = focusSize === key ? ' size-row-focus' : '';
            return `
            <div class="size-row${focus}">
              <span class="size-label">${label}</span>
              <div class="size-track">
                <div class="size-fill" style="width:${Math.min(100, pct)}%;background:${scoreColor(pct)}"></div>
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
          style="--card-accent: ${scoreColor(day.percentage)}; --card-bg: ${scoreBgColor(day.percentage)}"
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

function scoreColor(pct: number): string {
  return getScoreColor(pct);
}

function scoreBgColor(pct: number): string {
  return getScoreBgColor(pct);
}

function renderBiologyInsightsPanel(dailyIndex: number | null, hourlyIndex: number | null): string {
  if (!weather || !getBiologyInsights()) return '';

  let displayPct = 0;
  let insights;
  let rainStatus = '';
  let timeWindow = '';

  if (hourlyIndex != null) {
    displayPct = hourlyScores[hourlyIndex] ?? 0;
    insights = getHourlyBiologyInsights(weather, hourlyIndex, displayPct);
    const ctx = getBiologyInsightsContext(weather, hourlyIndex);
    rainStatus = ctx.rainStatus;
    timeWindow = ctx.timeWindow;
  } else if (dailyIndex != null) {
    displayPct = dailyForecasts[dailyIndex]?.percentage ?? dailyPercentages[dailyIndex] ?? 0;
    insights = getDailyBiologyInsights(weather, dailyIndex, displayPct);
    const nowIdx = weather.hourly.findIndex(
      (h) => h.dt >= Math.floor(Date.now() / 1000) - 3600,
    );
    if (nowIdx >= 0) {
      const ctx = getBiologyInsightsContext(weather, nowIdx);
      rainStatus = ctx.rainStatus;
      timeWindow = ctx.timeWindow;
    }
  } else {
    return '';
  }

  const activityClass = insights.activity.toLowerCase().replace(/\s+/g, '-');

  return `
    <div class="v3-meta-panel">
      <div class="v3-meta-item">
        <span class="v3-meta-label">Activity</span>
        <span class="v3-meta-value v3-activity-${activityClass}">${insights.activity}</span>
      </div>
      <div class="v3-meta-item">
        <span class="v3-meta-label">Confidence</span>
        <span class="v3-meta-value v3-confidence-${insights.confidence.toLowerCase()}">${insights.confidence}</span>
      </div>
      ${rainStatus ? `<div class="v3-meta-item"><span class="v3-meta-label">Rain</span><span class="v3-meta-value">${rainStatus}</span></div>` : ''}
      ${timeWindow ? `<div class="v3-meta-item"><span class="v3-meta-label">Window</span><span class="v3-meta-value">${timeWindow}</span></div>` : ''}
    </div>`;
}

function renderAlgorithmButton(): string {
  const algo = getActiveAlgorithm();
  const icon = getAlgorithmIcon(algo.id);
  const variant = algo.id === 'hybrid-literature-v2' ? 'algorithm-btn-alt' : '';
  return `
    <button
      id="algorithm-switch"
      class="btn-ghost algorithm-btn ${variant}"
      type="button"
      title="Prediction model: ${algo.name}. Click to switch."
      aria-label="Switch prediction model (${algo.name})"
    >${icon}</button>`;
}

function renderBiologyInsightsButton(): string {
  const on = getBiologyInsights();
  return `
    <button
      id="toggle-biology-insights"
      class="btn-ghost biology-insights-btn ${on ? 'btn-active' : ''}"
      type="button"
      title="${on ? 'Hide biology insights (confidence, activity, rain)' : 'Show biology insights — confidence & activity from RF trees'}"
      aria-label="Toggle biology insights"
    >🧬</button>`;
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

function renderWeatherSourceNote(): string {
  if (!weather) return '';
  return '<p class="weather-source-note">Forecast data: Open-Meteo (surface pressure at 2 m)</p>';
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
  const anchor = getHourlyAnchor();
  const slots = getNext24HourSlots(weather, hourlyScores, anchor);
  const greenThreshold = getGreenThreshold();
  const greenSlots = slots.filter((s) => s.percentage >= greenThreshold);
  const peak = slots.reduce((max, s) => Math.max(max, s.percentage), 0);
  const peakSlot = slots.find((s) => s.percentage === peak);

  const summaryLine =
    greenSlots.length > 0
      ? `${greenSlots.length} green · peak ${peak}%${peakSlot ? ` ${peakSlot.timeLabel}` : ''}`
      : peak > 0
        ? `Peak ${peak}%${peakSlot ? ` ${peakSlot.timeLabel}` : ''}`
        : 'No flight windows';

  const strip = slots
    .map((slot) => {
      const isGreen = slot.percentage >= greenThreshold;
      const title = `${slot.timeLabel}: ${slot.percentage}%`;
      const hourlyIndex = weather!.hourly.findIndex((h) => h.dt === slot.dt);
      const tip = isGreen ? renderGreenSlotSpeciesTip(hourlyIndex, slot.percentage) : '';
      return `<div class="glance-block ${isGreen ? 'glance-green' : ''}" style="background:${scoreColor(slot.percentage)}" ${tip ? '' : `title="${title}"`}>${tip}</div>`;
    })
    .join('');

  const labels = slots
    .filter((_, i) => i % 3 === 0)
    .map((slot) => `<span>${slot.timeLabel.replace(':00', '').replace(' ', '')}</span>`)
    .join('');

  if (getSimpleMode()) {
    return `
    <section class="forecast-view forecast-view-compact">
      <div class="hourly-view-toolbar">${renderHourlyAnchorToggle()}</div>
      <p class="compact-summary" style="--accent: ${scoreColor(peak)}">${summaryLine}</p>
      <div class="glance-strip-wrap glance-strip-wrap-compact">
        <div class="glance-strip glance-strip-compact">${strip || '<p class="empty-note">No data</p>'}</div>
        <div class="glance-labels glance-labels-compact">${labels}</div>
      </div>
    </section>`;
  }

  const greenTimes = greenSlots.map((s) => s.timeLabel).join(', ');
  const peakHourlyIndex =
    peakSlot != null ? weather.hourly.findIndex((h) => h.dt === peakSlot.dt) : -1;
  const peakInsightsMeta = peakHourlyIndex >= 0 ? renderBiologyInsightsPanel(null, peakHourlyIndex) : '';
  const greenLabel = `≥${getGreenThreshold()}%`;

  return `
    <section class="forecast-view glance-24h">
      <div class="glance-header" style="--accent: ${scoreColor(peak)}">
        <div class="glance-header-row">
          <h2>${anchor === 'now' ? 'Next 24 hours' : 'Today (midnight – midnight)'}</h2>
          ${renderHourlyAnchorToggle()}
        </div>
        <p class="glance-summary">${summaryLine}</p>
        ${greenTimes ? `<p class="glance-green-times">🟢 ${greenTimes}</p>` : ''}
        ${peakInsightsMeta}
      </div>
      <div class="glance-strip-wrap">
        <div class="glance-strip">${strip || '<p class="empty-note">No data</p>'}</div>
        <div class="glance-labels">${labels}</div>
      </div>
      <p class="glance-legend-inline"><span class="leg-swatch" style="background:#b71c1c"></span> unlikely <span class="leg-swatch" style="background:#e65100"></span> possible <span class="leg-swatch" style="background:#2e7d32"></span> likely (${greenLabel})</p>
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

  if (getSimpleMode()) {
    const compactLine = hasGreen && bestGreenDay
      ? `Best: ${bestGreenDay.label} · ${showPercentages ? `${bestGreenDay.percentage}%` : getEmoji(bestGreenDay.percentage)} 🟢`
      : `Peak ${showPercentages ? `${weekHigh}%` : getEmoji(weekHigh)}${weekHighDay ? ` · ${weekHighDay.label}` : ''}`;
    return `
    <section class="forecast-view forecast-view-compact">
      <p class="compact-summary" style="--accent: ${hasGreen ? '#81c784' : scoreColor(weekHigh)}">${compactLine}</p>
      <div class="day-cards day-cards-compact">${renderDayCards(days)}</div>
      ${renderCompactHourlyPanel()}
    </section>`;
  }

  return `
    <section class="forecast-view">
      <div class="summary-card" style="--accent: ${hasGreen ? '#2e7d32' : scoreColor(weekHigh)}">
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
                style="${pct != null ? `--cell-accent: ${scoreColor(pct)}` : ''}"
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

  if (getSimpleMode()) {
    const compactLine =
      greenDays > 0 ? `${greenDays} green day${greenDays === 1 ? '' : 's'} · ${monthLabel}` : `${monthLabel} · no green days`;
    return `
    <section class="forecast-view forecast-view-compact">
      <p class="compact-summary">${compactLine}</p>
      <div class="month-calendar month-calendar-compact">
        <div class="month-weekdays">
          ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<span>${d}</span>`).join('')}
        </div>
        ${grid}
      </div>
    </section>`;
  }

  return `
    <section class="forecast-view">
      <div class="summary-card" style="--accent: ${greenDays > 0 ? '#2e7d32' : scoreColor(Math.max(...dailyPercentages, 0))}">
        <h2>${monthLabel}</h2>
        <p class="summary-text">
          ${
            greenDays > 0
              ? `<strong>${greenDays}</strong> day${greenDays === 1 ? '' : 's'} with a green hourly window (≥${getGreenThreshold()}%).`
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
  const diurnalIdx = diurnalHour ? weather.hourly.indexOf(diurnalHour) : -1;
  const nocturnalIdx = nocturnalHour ? weather.hourly.indexOf(nocturnalHour) : -1;
  const diurnalPct =
    diurnalHour && !isEstimate
      ? percentageToInt(
          scoreHourlyProbability(
            weather.lat,
            weather.lon,
            diurnalHour,
            weather.timezoneOffset,
            weather,
            diurnalIdx >= 0 ? diurnalIdx : undefined,
          ),
        )
      : 0;
  const nocturnalPct =
    nocturnalHour && !isEstimate
      ? percentageToInt(
          scoreHourlyProbability(
            weather.lat,
            weather.lon,
            nocturnalHour,
            weather.timezoneOffset,
            weather,
            nocturnalIdx >= 0 ? nocturnalIdx : undefined,
          ),
        )
      : 0;

  const dayOverallPct = day.dailyModelPercentage ?? day.percentage;
  const dailyInsightsMeta = dayIndex >= 0 ? renderBiologyInsightsPanel(dayIndex, null) : '';

  return `
    <section class="day-detail">
      <div class="detail-header">
        <h2>${day.label === 'Today' ? 'Today' : day.label + ' (' + day.weekday + ')'}</h2>
        ${isEstimate ? '<p class="estimate-badge">Climate average · daily estimate only</p>' : ''}
        ${day.hasGreenSlot ? `<p class="green-slot-badge">🟢 Has a green hourly window (≥${getGreenThreshold()}%)</p>` : ''}
        <p class="flight-status" style="color: ${scoreColor(day.percentage)}">${day.flightText}</p>
        ${dailyInsightsMeta}
      </div>

      ${
        !isEstimate
          ? `
      <div class="today-scores">
        <div class="score-box" style="--accent: ${scoreColor(diurnalPct)}">
          <span class="score-label">11 AM window</span>
          <span class="score-value">${showPercentages ? `${diurnalPct}%` : getEmoji(diurnalPct)}</span>
        </div>
        <div class="score-box primary" style="--accent: ${scoreColor(dayOverallPct)}">
          <span class="score-label">Day overall</span>
          <span class="score-value">${showPercentages ? `${dayOverallPct}%` : getEmoji(dayOverallPct)}</span>
        </div>
        <div class="score-box" style="--accent: ${scoreColor(nocturnalPct)}">
          <span class="score-label">7 PM window</span>
          <span class="score-value">${showPercentages ? `${nocturnalPct}%` : getEmoji(nocturnalPct)}</span>
        </div>
      </div>

      <div class="detail-panel">
        <div class="detail-panel-head">
          <h3>Hourly flight probability — ${day.label}</h3>
          ${dayIndex === 0 ? renderHourlyAnchorToggle(true) : ''}
        </div>
        ${dayIndex >= 0 ? renderHourlyChart(dayIndex) : ''}
      </div>`
          : `
      <div class="today-scores single">
        <div class="score-box primary" style="--accent: ${scoreColor(day.percentage)}">
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
        <button id="toggle-theme" class="btn-ghost" type="button" title="Switch to ${getTheme() === 'dark' ? 'light' : 'dark'} mode" aria-label="Toggle light or dark mode">
          ${getTheme() === 'dark' ? '☀️' : '🌙'}
        </button>
        <button id="toggle-simple" class="btn-ghost ${getSimpleMode() ? 'btn-active' : ''}" type="button" title="${getSimpleMode() ? 'Exit compact layout' : 'Compact layout — fit more on screen'}" aria-label="Toggle compact layout">
          ${getSimpleMode() ? '⊞' : '⊟'}
        </button>
        <button id="toggle-mode" class="btn-ghost" title="Toggle percentage / emoji display">
          ${showPercentages ? '🐜' : '%'}
        </button>
        ${renderAlgorithmButton()}
        ${renderBiologyInsightsButton()}
        ${renderSpeciesControl()}
        ${renderSightingsButton()}
      </div>
      ${algorithmToast ? `<div class="algorithm-toast" role="status">${algorithmToast}</div>` : ''}
    </div>

    <div class="location-search-sticky">${renderLocationSearchBar(weather.locationName, getSimpleMode())}</div>

    <header class="header ${getSimpleMode() ? 'header-compact' : ''}">
      <div class="header-top">
        <div class="brand">
          <span class="brand-icon">🪽🐜</span>
          <div>
            <h1>Nuptial Radar</h1>
            ${getSimpleMode() ? '' : '<p class="tagline">Ant nuptial flight predictor</p>'}
          </div>
        </div>
      </div>

      ${getSimpleMode() ? '' : `<p class="location-name">${weather.locationName}</p>`}
      ${getSimpleMode() ? '' : renderWeatherSourceNote()}
      ${getSimpleMode() ? '' : renderCalibrationNote(weather.lat, weather.lon, getLocalCalibrationSummary)}
      ${renderViewSwitcher()}
    </header>

    <main class="main">
      ${weather ? renderSpeciesOutlook(weather, hourlyScores) : ''}
      ${renderForecastContent()}

      <section class="legend">
        <h3>Confidence scale</h3>
        <p class="legend-emojis">👎 🤏 🤞 🐜👌 🐜👍 🐜💪 🐜🫶</p>
        <p class="legend-note">
          Based on the
          <a href="https://github.com/bradrushworth/nuptialflight" target="_blank" rel="noopener">nuptialflight</a>
          random-forest models. Red &lt;50%, amber 50–54%, green ≥${getGreenThreshold()}%.
          Log sightings with 📝 to calibrate forecasts using your local flight history.
          Use 🐜 to filter by genus (Camponotus, Solenopsis, …) — scores factor rain lag, month, and time of day.
        </p>
      </section>
    </main>

    <footer class="footer">
      <p>Weather from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> · Models from nuptialflight (GPL-3.0)</p>
    </footer>
    ${renderSightingsModal()}
    ${renderSpeciesInfoModal()}
    ${renderSpeciesPopoverPanel()}
  `;

  bindEvents();
  bindSightingsModal();
  bindLocationSearchInputs();
  positionSpeciesPopover();
  hideGreenSpeciesTipFloat();
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

  document.getElementById('toggle-theme')?.addEventListener('click', () => {
    toggleTheme();
    render();
  });

  document.getElementById('toggle-simple')?.addEventListener('click', () => {
    toggleSimpleMode();
    render();
  });

  document.querySelectorAll('.toggle-hourly-anchor').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleHourlyAnchor();
      render();
    });
  });

  document.getElementById('toggle-biology-insights')?.addEventListener('click', () => {
    toggleBiologyInsights();
    render();
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
        ${renderPromptLocationSearch()}
        <div class="prompt-buttons">
          <button id="prompt-ip-btn" class="btn-primary">Use approximate location</button>
        </div>
      </div>
    </div>`;

  document.getElementById('prompt-ip-btn')?.addEventListener('click', () => {
    void loadFromApproximate();
  });

  bindLocationSearchInputs();
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

async function loadFromApproximate(): Promise<void> {
  showLoading('Estimating location from network…');
  const approx = await fetchApproximateLocation();
  if (approx) {
    await loadLocation(approx.lat, approx.lon, approx.name);
    return;
  }
  showLocationPrompt('Could not estimate your location automatically.');
}

async function init(): Promise<void> {
  initLocationSearch((lat, lon, name) => {
    void loadLocation(lat, lon, name);
  });
  initSpeciesUi({
    onRender: () => render(),
    onSpeciesChange: () => {
      rebuildForecasts();
      render();
    },
  });
  loadSavedAlgorithmId();
  loadSavedSpeciesId();
  showLoading('Loading prediction models…');
  try {
    await ensureModelsLoaded();
    try {
      await initSupabase();
      await refreshSightingsCache();
    } catch (e) {
      console.warn('Sightings sync unavailable:', e);
    }
    const saved = loadSavedLocation();
    if (saved) {
      await loadLocation(saved.lat, saved.lon, saved.name);
      return;
    }

    const approx = await fetchApproximateLocation();
    if (approx) {
      await loadLocation(approx.lat, approx.lon, `${approx.name} (approx.)`);
      return;
    }

    showLocationPrompt();
  } catch {
    showLocationPrompt('Could not load forecast models. Check your connection and try searching for a city.');
  }
}

init();
