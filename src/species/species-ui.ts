/**
 * Species selector popover, outlook panel, and documentation modal.
 */
import type { WeatherData } from '../types';
import {
  getSpeciesById,
  listSpecies,
  searchSpecies,
  speciesPresentAt,
  tabCompleteSpecies,
  type SpeciesProfile,
} from './catalog';
import type { LocationPlace } from './range';
import {
  clearSelectedSpecies,
  clearSelectedSpeciesIfOutOfRange,
  getSelectedSpecies,
  getSelectedSpeciesId,
  setSelectedSpeciesId,
} from './selection';
import { bestFlightWindows, rankSpeciesForHourlySlot, rankSpeciesOutlook, type SpeciesHourRank, type SpeciesOutlookBadge } from './timing';
import { getGreenThreshold, getScoreColor, scoreHourlyBaseForWeather } from '../algorithms/scoring';

let popoverOpen = false;
let infoModalOpen = false;
let infoSpeciesId: string | null = null;
let highlight = -1;
let onRender: (() => void) | null = null;
let onSpeciesChange: (() => void) | null = null;
let delegationBound = false;

/** Forecast snapshot for autofill badges (green / #1) and green-slot tips. */
let outlookById = new Map<string, SpeciesOutlookBadge>();
let topSpeciesId: string | null = null;
let currentPlace: LocationPlace | null = null;
let tipWeather: WeatherData | null = null;
let baseHourlyProbs: number[] = [];

/** Drop out-of-range selection before scores are computed. */
export function syncSpeciesToWeatherPlace(weather: WeatherData | null): void {
  currentPlace = weather?.place ?? null;
  clearSelectedSpeciesIfOutOfRange(currentPlace);
}

export function setSpeciesForecastContext(weather: WeatherData | null): void {
  tipWeather = weather;
  currentPlace = weather?.place ?? null;
  if (!weather || weather.hourly.length === 0) {
    outlookById = new Map();
    topSpeciesId = null;
    baseHourlyProbs = [];
    return;
  }
  const base = scoreHourlyBaseForWeather(weather);
  baseHourlyProbs = base;
  const ranked = rankSpeciesOutlook(weather, base, getGreenThreshold(), currentPlace);
  outlookById = ranked.byId;
  topSpeciesId = ranked.topId;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Hover/focus tip listing top local genera for a green hourly slot. */
export function renderGreenSlotSpeciesTip(hourlyIndex: number, displayPct: number): string {
  if (!tipWeather || hourlyIndex < 0 || hourlyIndex >= tipWeather.hourly.length) return '';
  if (displayPct < getGreenThreshold()) return '';

  const base = baseHourlyProbs[hourlyIndex] ?? 0.01;
  const ranks = rankSpeciesForHourlySlot(tipWeather, base, hourlyIndex, 5, currentPlace);
  if (ranks.length === 0) return '';

  return renderGreenSpeciesTipMarkup(ranks);
}

function renderGreenSpeciesTipMarkup(ranks: SpeciesHourRank[]): string {
  const rows = ranks
    .map(
      (r, i) => `
      <li>
        <span class="green-tip-rank">${i + 1}.</span>
        <span class="green-tip-name"><em>${escapeHtml(r.genus)}</em></span>
        <span class="green-tip-pct" style="color:${getScoreColor(r.percentage)}">${r.percentage}%</span>
      </li>`,
    )
    .join('');

  return `
    <span class="green-species-tip" tabindex="0" role="img" aria-label="Top genera for this hour">
      <span class="green-species-tip-icon" aria-hidden="true">🐜</span>
      <span class="green-species-tip-panel" hidden>
        <strong class="green-tip-heading">Highest chance</strong>
        <ol class="green-tip-list">${rows}</ol>
      </span>
    </span>`;
}

export function initSpeciesUi(handlers: {
  onRender: () => void;
  onSpeciesChange: () => void;
}): void {
  onRender = handlers.onRender;
  onSpeciesChange = handlers.onSpeciesChange;
  bindDelegationOnce();
}

function requestRender(): void {
  onRender?.();
}

function notifySpeciesChange(): void {
  onSpeciesChange?.();
}

function closePopover(): void {
  popoverOpen = false;
  highlight = -1;
}

function openPopover(): void {
  popoverOpen = true;
  highlight = -1;
}

export function openSpeciesInfoModal(speciesId?: string | null): void {
  const id = speciesId ?? getSelectedSpeciesId();
  if (!id || !getSpeciesById(id)) return;
  infoSpeciesId = id;
  infoModalOpen = true;
  closePopover();
}

export function closeSpeciesInfoModal(): void {
  infoModalOpen = false;
  infoSpeciesId = null;
}

export function isSpeciesInfoOpen(): boolean {
  return infoModalOpen;
}

export function renderSpeciesControl(): string {
  const selected = getSelectedSpecies();
  const label = selected ? selected.genus : 'All';
  const infoDisabled = selected ? '' : 'disabled';
  const activeClass = selected ? ' btn-active' : '';

  return `
    <div class="species-control">
      <button
        id="species-toggle"
        class="btn-ghost species-toggle${activeClass}"
        type="button"
        title="Filter forecast by ant genus"
        aria-expanded="${popoverOpen}"
        aria-haspopup="listbox"
      >
        🐜 ${escapeHtml(label)}
      </button>
      <button
        id="species-info-btn"
        class="btn-ghost species-info-btn"
        type="button"
        title="Species flight documentation"
        aria-label="Species flight documentation"
        ${infoDisabled}
      >ℹ</button>
    </div>`;
}

/** Rendered outside the scrollable toolbar so overflow does not clip it. */
export function renderSpeciesPopoverPanel(): string {
  if (!popoverOpen) return '';
  return renderSpeciesPopover();
}

export function positionSpeciesPopover(): void {
  const pop = document.getElementById('species-popover');
  const anchor = document.querySelector('.species-control');
  if (!(pop instanceof HTMLElement) || !(anchor instanceof HTMLElement)) return;

  const rect = anchor.getBoundingClientRect();
  const width = Math.min(288, window.innerWidth - 16);
  let left = rect.right - width;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  const top = Math.min(rect.bottom + 8, window.innerHeight - 120);

  pop.style.position = 'fixed';
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
  pop.style.right = 'auto';
  pop.style.width = `${width}px`;
  pop.style.zIndex = '600';
}

function speciesResultBadges(speciesId: string): string {
  const outlook = outlookById.get(speciesId);
  if (!outlook) return '';
  const parts: string[] = [];
  if (topSpeciesId === speciesId) {
    parts.push('<span class="species-badge species-badge-top" title="Highest chance in the forecast">1️⃣</span>');
  }
  if (outlook.hasGreen) {
    parts.push(
      `<span class="species-badge species-badge-green" title="Green flight window in the coming days (peak ${outlook.peakPct}%)">🟢</span>`,
    );
  }
  if (parts.length === 0) return '';
  return `<span class="species-result-badges">${parts.join('')}</span>`;
}

function renderSpeciesResultButton(s: SpeciesProfile, index: number): string {
  return `
          <button
            type="button"
            class="species-result${index === highlight ? ' species-result-active' : ''}"
            data-species-id="${s.id}"
            role="option"
          >
            <span class="species-result-main">
              <strong>${escapeHtml(s.genus)}</strong>
              <span>${escapeHtml(s.commonName)}</span>
            </span>
            ${speciesResultBadges(s.id)}
          </button>`;
}

function renderSpeciesPopover(): string {
  const results = searchSpecies('', 12, currentPlace);
  return `
    <div class="species-popover" id="species-popover" role="dialog" aria-label="Search species">
      <input
        id="species-search"
        class="species-search-input"
        type="text"
        placeholder="Search genus…"
        autocomplete="off"
        spellcheck="false"
        aria-autocomplete="list"
        aria-controls="species-results"
      />
      <div id="species-results" class="species-results" role="listbox">
        <button type="button" class="species-result" data-species-id="" role="option">
          <span class="species-result-main">
            <strong>All species</strong>
            <span>Generic timing only</span>
          </span>
        </button>
        ${results.map((s, i) => renderSpeciesResultButton(s, i)).join('')}
      </div>
      <p class="species-popover-hint">Native/invasive here · 🟢 green · 1️⃣ top · Tab to complete</p>
    </div>`;
}

function monthChips(profile: SpeciesProfile): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return profile.monthWeights
    .map((w, i) => {
      const level = w >= 0.85 ? 'peak' : w >= 0.55 ? 'good' : w >= 0.3 ? 'low' : 'off';
      return `<span class="species-month-chip species-month-${level}" title="${names[i]}: ${Math.round(w * 100)}%">${names[i]}</span>`;
    })
    .join('');
}

function hourTimeline(profile: SpeciesProfile): string {
  return profile.hourWeights
    .map((w, h) => {
      const level = w >= 0.85 ? 'peak' : w >= 0.5 ? 'good' : 'off';
      const label = h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
      return `<span class="species-hour-cell species-hour-${level}" title="${label}: ${Math.round(w * 100)}%">${h % 3 === 0 ? label : ''}</span>`;
    })
    .join('');
}

export function renderSpeciesInfoModal(): string {
  if (!infoModalOpen || !infoSpeciesId) return '';
  const s = getSpeciesById(infoSpeciesId);
  if (!s) return '';

  const lag = s.rainLagHours;
  const presence = s.range.presence;
  const presenceLabel =
    presence === 'invasive' ? 'Invasive / established' : presence === 'established' ? 'Established' : 'Native';
  return `
    <div class="sighting-overlay species-info-overlay" id="species-info-overlay" role="dialog" aria-modal="true" aria-labelledby="species-info-title">
      <div class="sighting-modal species-info-modal">
        <header class="sighting-modal-header">
          <div>
            <h2 id="species-info-title"><em>${escapeHtml(s.genus)}</em> — ${escapeHtml(s.commonName)}</h2>
            <p class="sighting-modal-sub">Size class: ${escapeHtml(s.sizeClass)} · Genus flight profile</p>
          </div>
          <button type="button" class="btn-icon sighting-close" id="species-info-close" aria-label="Close">✕</button>
        </header>

        <div class="species-info-body">
          <section>
            <h3>Range at this location</h3>
            <p><strong>${escapeHtml(presenceLabel)}</strong>${s.range.presenceNote ? ` — ${escapeHtml(s.range.presenceNote)}` : ''}</p>
          </section>
          <section>
            <h3>Conditions</h3>
            <p>${escapeHtml(s.conditionsSummary)}</p>
          </section>
          <section>
            <h3>Flight pattern</h3>
            <p>${escapeHtml(s.flightPatternNotes)}</p>
          </section>
          <section>
            <h3>Typical months (from season curve)</h3>
            <div class="species-month-chips">${monthChips(s)}</div>
            <p class="species-season-note">Peak DOY ${s.season.peakStart}–${s.season.peakEnd} · ramp ${s.season.rampDays}d · fade ${s.season.fadeDays}d (N. hemisphere)</p>
          </section>
          <section>
            <h3>Typical hours (local)</h3>
            <div class="species-hour-timeline">${hourTimeline(s)}</div>
          </section>
          <section>
            <h3>Rain lag preference</h3>
            <p>Soft window ${lag.softMin}–${lag.softMax}h after rain · peak around ${lag.optimal}h.</p>
          </section>
          <section>
            <h3>Sources</h3>
            <ul class="species-sources">
              ${s.sources.map((src) => `<li>${escapeHtml(src)}</li>`).join('')}
            </ul>
          </section>
        </div>
      </div>
    </div>`;
}

export function renderSpeciesOutlook(weather: WeatherData, hourlyScores: number[]): string {
  const selected = getSelectedSpecies();
  if (!selected) return '';

  const windows = bestFlightWindows(weather, hourlyScores, 5);
  if (windows.length === 0) {
    return `
      <section class="species-outlook">
        <div class="species-outlook-head">
          <h3>Best windows for <em>${escapeHtml(selected.genus)}</em></h3>
          <button type="button" class="btn-ghost species-outlook-info" data-open-species-info="${selected.id}">ℹ Details</button>
        </div>
        <p class="species-outlook-empty">No strong flight windows in the loaded forecast for this genus.</p>
      </section>`;
  }

  return `
    <section class="species-outlook">
      <div class="species-outlook-head">
        <h3>Best windows for <em>${escapeHtml(selected.genus)}</em></h3>
        <button type="button" class="btn-ghost species-outlook-info" data-open-species-info="${selected.id}">ℹ Details</button>
      </div>
      <ul class="species-outlook-list">
        ${windows
          .map(
            (w) => `
          <li class="species-outlook-item" style="--accent:${getScoreColor(w.percentage)}">
            <div class="species-outlook-when">
              <strong>${escapeHtml(w.dayLabel)}</strong>
              <span>${escapeHtml(w.timeLabel)}</span>
            </div>
            <div class="species-outlook-pct">${w.percentage}%</div>
            <p class="species-outlook-reason">${escapeHtml(w.reason)}</p>
          </li>`,
          )
          .join('')}
      </ul>
    </section>`;
}

function renderFilteredResults(query: string): void {
  const box = document.getElementById('species-results');
  if (!box) return;
  const matches = query.trim()
    ? searchSpecies(query, 8, currentPlace)
    : listSpecies(currentPlace).slice(0, 12);
  highlight = matches.length > 0 ? 0 : -1;

  const allBtn = `
    <button type="button" class="species-result" data-species-id="" role="option">
      <span class="species-result-main">
        <strong>All species</strong>
        <span>Generic timing only</span>
      </span>
    </button>`;

  box.innerHTML = allBtn + matches.map((s, i) => renderSpeciesResultButton(s, i)).join('');
}

function selectSpeciesFromEl(el: HTMLElement): void {
  const id = el.dataset.speciesId ?? '';
  if (!id) clearSelectedSpecies();
  else {
    const profile = getSpeciesById(id);
    if (!profile || !speciesPresentAt(profile, currentPlace)) return;
    setSelectedSpeciesId(id);
  }
  closePopover();
  notifySpeciesChange();
}

function ensureGreenTipFloat(): HTMLElement {
  let el = document.getElementById('green-species-tip-float');
  if (el instanceof HTMLElement) return el;
  el = document.createElement('div');
  el.id = 'green-species-tip-float';
  el.className = 'green-species-tip-float';
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

export function hideGreenSpeciesTipFloat(): void {
  const el = document.getElementById('green-species-tip-float');
  if (el instanceof HTMLElement) {
    el.hidden = true;
    el.innerHTML = '';
  }
}

function positionGreenTipFloat(anchor: HTMLElement, html: string): void {
  const float = ensureGreenTipFloat();
  float.innerHTML = html;
  float.hidden = false;

  const rect = anchor.getBoundingClientRect();
  const pad = 8;
  // Measure after content is visible
  float.style.left = '0px';
  float.style.top = '0px';
  const fw = float.offsetWidth;
  const fh = float.offsetHeight;

  let left = rect.left + rect.width / 2 - fw / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - fw - pad));

  let top = rect.top - fh - 8;
  if (top < pad) {
    // Flip below if not enough room above
    top = rect.bottom + 8;
  }
  top = Math.max(pad, Math.min(top, window.innerHeight - fh - pad));

  float.style.left = `${left}px`;
  float.style.top = `${top}px`;
}

function showGreenTipFromEl(tip: HTMLElement): void {
  const panel = tip.querySelector('.green-species-tip-panel');
  if (!(panel instanceof HTMLElement)) return;
  positionGreenTipFloat(tip, panel.innerHTML);
}

function bindDelegationOnce(): void {
  if (delegationBound) return;
  delegationBound = true;

  document.addEventListener('pointerover', (e) => {
    const tip = (e.target as HTMLElement).closest('.green-species-tip');
    if (!(tip instanceof HTMLElement)) return;
    showGreenTipFromEl(tip);
  });

  document.addEventListener('pointerout', (e) => {
    const tip = (e.target as HTMLElement).closest('.green-species-tip');
    if (!(tip instanceof HTMLElement)) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest?.('.green-species-tip') === tip) return;
    if (related?.closest?.('#green-species-tip-float')) return;
    hideGreenSpeciesTipFloat();
  });

  document.addEventListener('focusin', (e) => {
    const tip = (e.target as HTMLElement).closest('.green-species-tip');
    if (tip instanceof HTMLElement) showGreenTipFromEl(tip);
  });

  document.addEventListener('focusout', (e) => {
    const tip = (e.target as HTMLElement).closest('.green-species-tip');
    if (!(tip instanceof HTMLElement)) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest?.('.green-species-tip') === tip) return;
    hideGreenSpeciesTipFloat();
  });

  window.addEventListener('scroll', () => hideGreenSpeciesTipFloat(), true);
  window.addEventListener('resize', () => hideGreenSpeciesTipFloat());

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;

    if (t.closest('#species-toggle')) {
      e.preventDefault();
      if (popoverOpen) closePopover();
      else openPopover();
      requestRender();
      queueMicrotask(() => document.getElementById('species-search')?.focus());
      return;
    }

    if (t.closest('#species-info-btn') || t.closest('[data-open-species-info]')) {
      e.preventDefault();
      const btn = t.closest('[data-open-species-info]') as HTMLElement | null;
      openSpeciesInfoModal(btn?.dataset.openSpeciesInfo ?? getSelectedSpeciesId());
      requestRender();
      return;
    }

    if (t.closest('#species-info-close') || t.id === 'species-info-overlay') {
      if (t.id === 'species-info-overlay' || t.closest('#species-info-close')) {
        closeSpeciesInfoModal();
        requestRender();
      }
      return;
    }

    const result = t.closest('.species-result') as HTMLElement | null;
    if (result && result.closest('#species-popover')) {
      e.preventDefault();
      selectSpeciesFromEl(result);
      return;
    }

    if (popoverOpen && !t.closest('.species-control') && !t.closest('#species-popover')) {
      closePopover();
      requestRender();
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (t.id !== 'species-search') return;
    renderFilteredResults((t as HTMLInputElement).value);
  });

  document.addEventListener('keydown', (e) => {
    if (infoModalOpen && e.key === 'Escape') {
      closeSpeciesInfoModal();
      requestRender();
      return;
    }

    const input = document.getElementById('species-search');
    if (!popoverOpen || !input || document.activeElement !== input) {
      if (popoverOpen && e.key === 'Escape') {
        closePopover();
        requestRender();
      }
      return;
    }

    const box = document.getElementById('species-results');
    if (!box) return;
    const items = [...box.querySelectorAll('.species-result')] as HTMLElement[];

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight = Math.min(items.length - 1, highlight + 1);
      items.forEach((el, i) => el.classList.toggle('species-result-active', i === highlight));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight = Math.max(0, highlight - 1);
      items.forEach((el, i) => el.classList.toggle('species-result-active', i === highlight));
    } else if (e.key === 'Tab') {
      const q = (input as HTMLInputElement).value;
      const match = tabCompleteSpecies(q, currentPlace);
      if (match) {
        e.preventDefault();
        (input as HTMLInputElement).value = match.genus;
        renderFilteredResults(match.genus);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = items[highlight] ?? items[0];
      if (active) selectSpeciesFromEl(active);
    } else if (e.key === 'Escape') {
      closePopover();
      requestRender();
    }
  });
}
