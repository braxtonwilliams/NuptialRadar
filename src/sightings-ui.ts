import { deleteSighting, formatSightingLabel, insertSighting, listSightings } from './db/sightings';
import type { SightingKind } from './db/types';
import { fetchWeatherSnapshot, getCurrentPosition } from './weather';

let modalOpen = false;
let saving = false;
let formError: string | null = null;
let onSaved: (() => void) | null = null;

export interface SightingFormDefaults {
  lat: number;
  lon: number;
  locationLabel?: string;
}

let defaults: SightingFormDefaults = { lat: 0, lon: 0 };

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function openSightingsModal(formDefaults: SightingFormDefaults, callback: () => void): void {
  defaults = formDefaults;
  onSaved = callback;
  formError = null;
  modalOpen = true;
}

export function closeSightingsModal(): void {
  modalOpen = false;
  formError = null;
  saving = false;
}

function finishModal(): void {
  const cb = onSaved;
  closeSightingsModal();
  onSaved = null;
  cb?.();
}

export function isSightingsModalOpen(): boolean {
  return modalOpen;
}

export function renderSightingsModal(): string {
  if (!modalOpen) return '';

  const sightings = listSightings(50);
  const nowLocal = toDatetimeLocalValue(new Date());

  return `
    <div class="sighting-overlay" id="sighting-overlay" role="dialog" aria-modal="true" aria-labelledby="sighting-modal-title">
      <div class="sighting-modal">
        <header class="sighting-modal-header">
          <div>
            <h2 id="sighting-modal-title">Log sighting or queen capture</h2>
            <p class="sighting-modal-sub">Saved to your account · used to calibrate forecasts near you</p>
          </div>
          <button type="button" class="btn-icon sighting-close" id="sighting-close" aria-label="Close">✕</button>
        </header>

        <form id="sighting-form" class="sighting-form">
          <fieldset class="sighting-fieldset">
            <legend>Type</legend>
            <label class="sighting-radio">
              <input type="radio" name="kind" value="sighting" checked />
              Nuptial flight sighting
            </label>
            <label class="sighting-radio">
              <input type="radio" name="kind" value="queen_capture" />
              Queen captured
            </label>
          </fieldset>

          <div class="sighting-row">
            <label class="sighting-label" for="sighting-when">When</label>
            <input
              id="sighting-when"
              name="when"
              type="datetime-local"
              class="sighting-input"
              value="${nowLocal}"
              required
            />
            <button type="button" class="btn-ghost sighting-inline-btn" id="sighting-now-btn">Now</button>
          </div>

          <div class="sighting-row">
            <label class="sighting-label" for="sighting-lat">Location</label>
            <div class="sighting-location-row">
              <input id="sighting-lat" name="lat" type="number" step="any" class="sighting-input sighting-coord" placeholder="Latitude" value="${defaults.lat.toFixed(5)}" required />
              <input id="sighting-lon" name="lon" type="number" step="any" class="sighting-input sighting-coord" placeholder="Longitude" value="${defaults.lon.toFixed(5)}" required />
              <button type="button" class="btn-ghost sighting-inline-btn" id="sighting-gps-btn" title="Use GPS now">📍</button>
            </div>
            ${defaults.locationLabel ? `<p class="sighting-hint">Default: ${defaults.locationLabel}</p>` : ''}
          </div>

          <div class="sighting-row two-col">
            <div>
              <label class="sighting-label" for="sighting-species">Species (optional)</label>
              <input id="sighting-species" name="species" type="text" class="sighting-input" placeholder="e.g. Camponotus pennsylvanicus" />
            </div>
            <div>
              <label class="sighting-label" for="sighting-size">Size mm (if unknown)</label>
              <input id="sighting-size" name="sizeMm" type="number" step="0.1" min="1" max="30" class="sighting-input" placeholder="e.g. 12" />
            </div>
          </div>

          <div class="sighting-row">
            <label class="sighting-label" for="sighting-notes">Notes (optional)</label>
            <textarea id="sighting-notes" name="notes" class="sighting-input sighting-textarea" rows="2" placeholder="Habitat, behavior, etc."></textarea>
          </div>

          ${formError ? `<p class="sighting-error" role="alert">${formError}</p>` : ''}

          <div class="sighting-actions">
            <button type="button" class="btn-ghost" id="sighting-cancel">Cancel</button>
            <button type="submit" class="btn-primary" id="sighting-save" ${saving ? 'disabled' : ''}>
              ${saving ? 'Saving…' : 'Save sighting'}
            </button>
          </div>
        </form>

        <section class="sighting-list-section">
          <h3>Your records (${sightings.length})</h3>
          ${
            sightings.length === 0
              ? '<p class="sighting-empty">No sightings yet. Log a flight or queen capture to personalize forecasts.</p>'
              : `<ul class="sighting-list">
            ${sightings
              .map(
                (s) => `
              <li class="sighting-item">
                <span class="sighting-item-label">${formatSightingLabel(s)}</span>
                <button type="button" class="btn-ghost sighting-delete" data-id="${s.id}" title="Delete">🗑</button>
              </li>`,
              )
              .join('')}
          </ul>`
          }
        </section>
      </div>
    </div>`;
}

export function bindSightingsModal(): void {
  if (!modalOpen) return;

  document.getElementById('sighting-close')?.addEventListener('click', () => {
    finishModal();
  });

  document.getElementById('sighting-cancel')?.addEventListener('click', () => {
    finishModal();
  });

  document.getElementById('sighting-overlay')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'sighting-overlay') {
      finishModal();
    }
  });

  document.getElementById('sighting-now-btn')?.addEventListener('click', () => {
    const input = document.getElementById('sighting-when') as HTMLInputElement;
    if (input) input.value = toDatetimeLocalValue(new Date());
  });

  document.getElementById('sighting-gps-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('sighting-gps-btn') as HTMLButtonElement;
    if (btn) btn.disabled = true;
    try {
      const pos = await getCurrentPosition();
      const latInput = document.getElementById('sighting-lat') as HTMLInputElement;
      const lonInput = document.getElementById('sighting-lon') as HTMLInputElement;
      if (latInput) latInput.value = pos.coords.latitude.toFixed(5);
      if (lonInput) lonInput.value = pos.coords.longitude.toFixed(5);
    } catch {
      formError = 'Could not get GPS location. Enter coordinates manually.';
      refreshModalOnly();
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.querySelectorAll('.sighting-delete').forEach((el) => {
    el.addEventListener('click', () => {
      const id = Number((el as HTMLElement).dataset.id);
      void deleteSighting(id)
        .then(() => onSaved?.())
        .catch((err) => {
          formError = err instanceof Error ? err.message : 'Failed to delete sighting';
          refreshModalOnly();
        });
    });
  });

  document.getElementById('sighting-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void handleSubmit(e.target as HTMLFormElement);
  });
}

function refreshModalOnly(): void {
  const overlay = document.getElementById('sighting-overlay');
  if (!overlay) return;
  const parent = overlay.parentElement;
  overlay.remove();
  parent?.insertAdjacentHTML('beforeend', renderSightingsModal());
  bindSightingsModal();
}

async function handleSubmit(form: HTMLFormElement): Promise<void> {
  if (saving) return;

  const data = new FormData(form);
  const kind = data.get('kind') as SightingKind;
  const whenRaw = data.get('when') as string;
  const lat = Number(data.get('lat'));
  const lon = Number(data.get('lon'));
  const species = (data.get('species') as string)?.trim() || null;
  const sizeRaw = data.get('sizeMm') as string;
  const sizeMm = sizeRaw ? Number(sizeRaw) : null;
  const notes = (data.get('notes') as string)?.trim() || null;

  if (!whenRaw || Number.isNaN(lat) || Number.isNaN(lon)) {
    formError = 'Please fill in time and location.';
    refreshModalOnly();
    return;
  }

  if (!species && (sizeMm == null || Number.isNaN(sizeMm))) {
    formError = 'Enter a species name or queen size in mm.';
    refreshModalOnly();
    return;
  }

  const observedAt = new Date(whenRaw);
  if (Number.isNaN(observedAt.getTime())) {
    formError = 'Invalid date/time.';
    refreshModalOnly();
    return;
  }

  saving = true;
  formError = null;
  refreshModalOnly();

  try {
    const weather = await fetchWeatherSnapshot(lat, lon, observedAt);
    await insertSighting({
      kind,
      latitude: lat,
      longitude: lon,
      observedAt,
      species,
      sizeMm,
      weather,
      notes,
    });
    finishModal();
  } catch (err) {
    saving = false;
    formError = err instanceof Error ? err.message : 'Failed to save sighting';
    refreshModalOnly();
  }
}

export function renderSightingsButton(): string {
  const count = listSightings(500).length;
  const badge = count > 0 ? `<span class="sighting-count">${count}</span>` : '';
  return `
    <button
      id="sightings-log-btn"
      class="btn-ghost sightings-btn"
      type="button"
      title="Log nuptial sighting or queen capture${count > 0 ? ` (${count} saved)` : ''}"
      aria-label="Log sighting or queen capture"
    >📝${badge}</button>`;
}

export function renderCalibrationNote(lat: number, lon: number, summaryFn: (lat: number, lon: number) => { count: number; nearestKm: number | null }): string {
  const { count, nearestKm } = summaryFn(lat, lon);
  if (count === 0) return '';
  const dist =
    nearestKm != null
      ? nearestKm < 1
        ? 'within 1 km'
        : `within ${Math.round(nearestKm)} km`
      : 'nearby';
  return `<p class="calibration-note">📍 ${count} local record${count === 1 ? '' : 's'} calibrating forecasts (${dist})</p>`;
}
