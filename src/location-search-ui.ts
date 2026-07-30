/**
 * Location search with debounced Open-Meteo geocoding autocomplete.
 * Uses document-level delegation so handlers survive full app re-renders.
 */
import type { GeocodeResult } from './types';
import { searchLocations } from './weather';

export type LocationSelectHandler = (lat: number, lon: number, name: string) => void;

const DEBOUNCE_MS = 280;
/** Open-Meteo geocoding returns useful matches from 3+ characters. */
const MIN_QUERY_LEN = 3;
const SEARCH_INPUT_SELECTOR = '#location-search, #prompt-search';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let searchGeneration = 0;
let activeHighlight = -1;
let onSelect: LocationSelectHandler | null = null;
let delegationBound = false;

function isSearchInput(el: EventTarget | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.matches(SEARCH_INPUT_SELECTOR);
}

function resultsElementForInput(input: HTMLInputElement): HTMLElement | null {
  const wrap = input.closest('.search-wrap');
  return wrap?.querySelector('.search-results') ?? null;
}

function formatLocationName(r: GeocodeResult): string {
  return [r.name, r.admin1, r.country].filter(Boolean).join(', ');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hideResults(resultsEl: HTMLElement | null): void {
  if (!resultsEl) return;
  resultsEl.classList.add('hidden');
  resultsEl.innerHTML = '';
  activeHighlight = -1;
}

function setHighlight(resultsEl: HTMLElement, index: number): void {
  const items = resultsEl.querySelectorAll('.search-result');
  if (items.length === 0) {
    activeHighlight = -1;
    return;
  }
  activeHighlight = ((index % items.length) + items.length) % items.length;
  items.forEach((el, i) => {
    el.classList.toggle('search-result-active', i === activeHighlight);
    if (i === activeHighlight) {
      el.scrollIntoView({ block: 'nearest' });
    }
  });
}

function selectResult(el: HTMLElement, resultsEl: HTMLElement | null): void {
  const lat = Number(el.dataset.lat);
  const lon = Number(el.dataset.lon);
  const name = el.dataset.name ?? '';
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !onSelect) return;
  hideResults(resultsEl);
  const input = resultsEl?.closest('.search-wrap')?.querySelector('input');
  if (input instanceof HTMLInputElement) {
    input.value = '';
    input.blur();
  }
  onSelect(lat, lon, name);
}

function bindResultButton(btn: HTMLElement, resultsEl: HTMLElement): void {
  const pick = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    selectResult(btn, resultsEl);
  };
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', pick);
  btn.addEventListener('touchend', pick, { passive: false });
}

function renderResults(resultsEl: HTMLElement, results: GeocodeResult[]): void {
  resultsEl.innerHTML = results
    .map(
      (r, i) => `
    <button
      type="button"
      class="search-result${i === 0 ? ' search-result-active' : ''}"
      data-lat="${r.lat}"
      data-lon="${r.lon}"
      data-name="${escapeAttr(formatLocationName(r))}"
      role="option"
      aria-selected="${i === 0}"
    >
      <strong>${escapeHtml(r.name)}</strong>
      <span>${escapeHtml([r.admin1, r.country].filter(Boolean).join(', '))}</span>
    </button>`,
    )
    .join('');

  activeHighlight = results.length > 0 ? 0 : -1;

  resultsEl.querySelectorAll('.search-result').forEach((btn) => {
    bindResultButton(btn as HTMLElement, resultsEl);
  });
}

async function runSearch(input: HTMLInputElement): Promise<void> {
  const query = input.value.trim();
  const resultsEl = resultsElementForInput(input);
  if (!resultsEl) return;

  const generation = ++searchGeneration;

  if (query.length < MIN_QUERY_LEN) {
    hideResults(resultsEl);
    input.setAttribute('aria-expanded', 'false');
    if (query.length > 0) {
      resultsEl.innerHTML = `<div class="search-empty">Type at least ${MIN_QUERY_LEN} characters…</div>`;
      resultsEl.classList.remove('hidden');
    }
    return;
  }

  resultsEl.innerHTML = '<div class="search-empty">Searching…</div>';
  resultsEl.classList.remove('hidden');
  input.setAttribute('aria-expanded', 'true');

  try {
    const results = await searchLocations(query);
    if (generation !== searchGeneration) return;
    if (!document.body.contains(input)) return;

    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="search-empty">No locations found</div>';
    } else {
      renderResults(resultsEl, results);
    }
    resultsEl.classList.remove('hidden');
  } catch (err) {
    if (generation !== searchGeneration) return;
    console.error('Location search failed:', err);
    resultsEl.innerHTML = '<div class="search-empty">Search failed — check connection</div>';
    resultsEl.classList.remove('hidden');
  }
}

function scheduleSearch(input: HTMLInputElement): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSearch(input);
  }, DEBOUNCE_MS);
}

function handleSearchKeydown(e: KeyboardEvent, input: HTMLInputElement): void {
  const resultsEl = resultsElementForInput(input);
  if (!resultsEl || resultsEl.classList.contains('hidden')) return;

  const items = resultsEl.querySelectorAll('.search-result');
  if (items.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setHighlight(resultsEl, activeHighlight + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setHighlight(resultsEl, activeHighlight - 1);
  } else if (e.key === 'Enter') {
    if (activeHighlight >= 0 && items[activeHighlight]) {
      e.preventDefault();
      selectResult(items[activeHighlight] as HTMLElement, resultsEl);
    }
  } else if (e.key === 'Escape') {
    hideResults(resultsEl);
    input.setAttribute('aria-expanded', 'false');
  }
}

function bindDelegationOnce(): void {
  if (delegationBound) return;
  delegationBound = true;

  document.addEventListener(
    'input',
    (e) => {
      if (isSearchInput(e.target)) scheduleSearch(e.target);
    },
    true,
  );

  document.addEventListener(
    'change',
    (e) => {
      if (isSearchInput(e.target)) scheduleSearch(e.target);
    },
    true,
  );

  document.addEventListener(
    'focusin',
    (e) => {
      if (!isSearchInput(e.target)) return;
      const query = e.target.value.trim();
      if (query.length >= MIN_QUERY_LEN) void runSearch(e.target);
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (isSearchInput(e.target)) handleSearchKeydown(e, e.target);
    },
    true,
  );

  document.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.search-wrap')) return;
    document.querySelectorAll('.search-results').forEach((el) => {
      hideResults(el as HTMLElement);
    });
    document.querySelectorAll(SEARCH_INPUT_SELECTOR).forEach((el) => {
      el.setAttribute('aria-expanded', 'false');
    });
  });
}

/** Set once at startup — wires search + autocomplete for all renders. */
export function initLocationSearch(selectHandler: LocationSelectHandler): void {
  onSelect = selectHandler;
  bindDelegationOnce();
}

/** Kept for compatibility; delegation handles re-renders automatically. */
export function bindLocationSearchInputs(): void {
  bindDelegationOnce();
}

export function renderLocationSearchBar(currentLocationName: string, compact: boolean): string {
  const compactClass = compact ? ' location-search-compact' : '';
  return `
    <div class="location-bar${compactClass}">
      ${compact ? `<p class="location-current" title="Current forecast location">${escapeHtml(currentLocationName)}</p>` : ''}
      <div class="search-wrap">
        <label class="visually-hidden" for="location-search">Search for a city</label>
        <input
          id="location-search"
          name="location-search"
          type="search"
          enterkeyhint="search"
          placeholder="Search for a city…"
          autocomplete="off"
          autocapitalize="words"
          spellcheck="false"
          role="combobox"
          aria-expanded="false"
          aria-autocomplete="list"
          aria-controls="location-search-results"
        />
        <div id="location-search-results" class="search-results hidden" role="listbox"></div>
      </div>
    </div>`;
}

export function renderPromptLocationSearch(): string {
  return `
        <div class="search-wrap search-wrap-prominent">
          <label class="visually-hidden" for="prompt-search">Search for your city</label>
          <input
            id="prompt-search"
            name="prompt-search"
            type="search"
            enterkeyhint="search"
            placeholder="Search for your city…"
            autocomplete="off"
            autocapitalize="words"
            spellcheck="false"
            role="combobox"
            aria-expanded="false"
            aria-autocomplete="list"
            aria-controls="prompt-search-results"
            autofocus
          />
          <div id="prompt-search-results" class="search-results hidden" role="listbox"></div>
        </div>`;
}
