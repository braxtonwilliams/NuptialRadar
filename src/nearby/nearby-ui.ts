/**
 * Nearby towns dropdown (US, <25 mi).
 * Top-left control always visible once weather is loaded; green badge when any town beats home.
 * Comparisons are always relative to a fixed home origin (not the currently viewed hop).
 */
import { getScoreColor } from '../algorithms/scoring';
import { getEmoji } from '../nuptials';
import { getNearbyHome, isNearNearbyHome, isViewingNearbyHop } from './home';
import { NEARBY_CACHE_TTL_MS, NEARBY_MAX_MILES, type NearbyScanResult } from './scan';

export type NearbyUiStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

let onSelectTown: ((lat: number, lon: number, name: string) => void) | null = null;
let onReturnHome: (() => void) | null = null;
let onRequestRender: (() => void) | null = null;
let nearbyBound = false;
let popoverOpen = false;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function betterCount(result: NearbyScanResult | null): number {
  if (!result) return 0;
  return result.towns.filter((t) => t.deltaVsHome > 0).length;
}

function cacheHoursLabel(): string {
  return `${Math.round(NEARBY_CACHE_TTL_MS / (60 * 60 * 1000))}h`;
}

export function closeNearbyPopover(): void {
  popoverOpen = false;
}

export function isNearbyPopoverOpen(): boolean {
  return popoverOpen;
}

export function initNearbyUi(handlers: {
  selectTown: (lat: number, lon: number, name: string) => void;
  returnHome: () => void;
  requestRender: () => void;
}): void {
  onSelectTown = handlers.selectTown;
  onReturnHome = handlers.returnHome;
  onRequestRender = handlers.requestRender;
  if (nearbyBound) return;
  nearbyBound = true;

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;

    if (t.closest('#nearby-toggle')) {
      e.preventDefault();
      popoverOpen = !popoverOpen;
      onRequestRender?.();
      return;
    }

    if (t.closest('[data-nearby-home]')) {
      e.preventDefault();
      popoverOpen = false;
      onReturnHome?.();
      return;
    }

    const town = t.closest('[data-nearby-lat]') as HTMLElement | null;
    if (town && onSelectTown) {
      const lat = Number(town.dataset.nearbyLat);
      const lon = Number(town.dataset.nearbyLon);
      const name = town.dataset.nearbyName ?? '';
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      popoverOpen = false;
      onSelectTown(lat, lon, name);
      return;
    }

    if (popoverOpen && !t.closest('.nearby-control') && !t.closest('#nearby-popover')) {
      popoverOpen = false;
      onRequestRender?.();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!popoverOpen || e.key !== 'Escape') return;
    popoverOpen = false;
    onRequestRender?.();
  });

  window.addEventListener('resize', () => {
    if (popoverOpen) positionNearbyPopover();
  });
}

/** Always-visible top-left nearby control (once the forecast UI is showing). */
export function renderNearbyControl(
  status: NearbyUiStatus,
  result: NearbyScanResult | null,
): string {
  const better = status === 'ready' ? betterCount(result) : 0;
  const away = isViewingNearbyHop();
  const notify =
    better > 0
      ? `<span class="nearby-notify" aria-label="${better} nearby town${better === 1 ? '' : 's'} with better conditions">${better}</span>`
      : '';

  const title =
    status === 'loading' || status === 'idle'
      ? 'Scanning nearby towns…'
      : status === 'error'
        ? 'Nearby towns scan failed — open for details'
        : status === 'unavailable'
          ? 'Nearby towns (US locations)'
          : better > 0
            ? `${better} nearby town${better === 1 ? '' : 's'} with better peak chance`
            : 'Compare nearby towns';

  const loadingClass = status === 'loading' || status === 'idle' ? ' nearby-loading' : '';
  const awayClass = away ? ' nearby-away' : '';

  return `
    <div class="nearby-control">
      <button
        id="nearby-toggle"
        class="btn-ghost nearby-toggle${loadingClass}${awayClass}${popoverOpen ? ' btn-active' : ''}"
        type="button"
        title="${escapeAttr(title)}"
        aria-expanded="${popoverOpen}"
        aria-haspopup="listbox"
        aria-label="Nearby towns"
      >
        <span class="nearby-toggle-label">📍 Nearby</span>
        ${notify}
      </button>
    </div>`;
}

/** Dropdown panel rendered outside the toolbar so it is not clipped. */
export function renderNearbyPopoverPanel(
  status: NearbyUiStatus,
  result: NearbyScanResult | null,
  showPercentages: boolean,
  viewingLat?: number,
  viewingLon?: number,
): string {
  if (!popoverOpen) return '';

  if (status === 'loading' || status === 'idle') {
    return `
      <div id="nearby-popover" class="nearby-popover" role="dialog" aria-label="Nearby towns">
        <div class="nearby-popover-head">
          <strong>Nearby towns</strong>
          <span>Scanning…</span>
        </div>
        <p class="nearby-popover-note">Under ${NEARBY_MAX_MILES} mi · refreshes about every ${cacheHoursLabel()}</p>
      </div>`;
  }

  if (status === 'unavailable') {
    return `
      <div id="nearby-popover" class="nearby-popover" role="dialog" aria-label="Nearby towns">
        <div class="nearby-popover-head">
          <strong>Nearby towns</strong>
          <span>Unavailable here</span>
        </div>
        <p class="nearby-popover-note">Nearby comparison runs for US forecast locations. Search a US city to compare towns within ${NEARBY_MAX_MILES} miles.</p>
      </div>`;
  }

  if (status === 'error') {
    return `
      <div id="nearby-popover" class="nearby-popover" role="dialog" aria-label="Nearby towns">
        <div class="nearby-popover-head">
          <strong>Nearby towns</strong>
          <span>Scan failed</span>
        </div>
        <p class="nearby-popover-note">Couldn’t compare nearby spots right now. Reload the forecast to try again.</p>
      </div>`;
  }

  if (!result) {
    return `
      <div id="nearby-popover" class="nearby-popover" role="dialog" aria-label="Nearby towns">
        <div class="nearby-popover-head">
          <strong>Nearby towns</strong>
          <span>No data yet</span>
        </div>
        <p class="nearby-popover-note">Waiting for the first nearby scan…</p>
      </div>`;
  }

  const home = getNearbyHome();
  const homeName = home?.name ?? result.homeName ?? 'Home';
  const away = isViewingNearbyHop();
  const better = betterCount(result);
  const summary =
    better > 0
      ? `${better} better than home (peak ${result.homePeak}%)`
      : `None better than home (peak ${result.homePeak}%)`;

  const region = result.usState && result.usState !== 'US' ? result.usState : 'US';
  const homeScore = showPercentages ? `${result.homePeak}%` : getEmoji(result.homePeak);
  const atHome =
    viewingLat != null &&
    viewingLon != null &&
    isNearNearbyHome(viewingLat, viewingLon);

  const homeRow = `
    <li>
      <button
        type="button"
        class="nearby-town nearby-home-row${atHome ? ' nearby-viewing' : ''}"
        role="option"
        data-nearby-home="1"
        ${atHome ? 'disabled' : ''}
      >
        <span class="nearby-town-rank">⌂</span>
        <span class="nearby-town-main">
          <strong>${escapeHtml(homeName.split(',')[0] ?? homeName)}</strong>
          <span class="nearby-town-meta">${atHome ? 'Your starting location' : 'Return to starting location'}</span>
        </span>
        <span class="nearby-town-score" style="color:${getScoreColor(result.homePeak)}">${homeScore}</span>
        <span class="nearby-town-delta">${atHome ? 'here' : 'home'}</span>
      </button>
    </li>`;

  const townRows =
    result.towns.length === 0
      ? `<p class="nearby-popover-empty">No other towns found within ${NEARBY_MAX_MILES} miles.</p>`
      : result.towns
          .map((t, i) => {
            const comparison =
              t.deltaVsHome === 0
                ? 'same'
                : t.deltaVsHome > 0
                  ? `better +${t.deltaVsHome}`
                  : `worse ${t.deltaVsHome}`;
            const betterClass = t.deltaVsHome > 0 ? ' nearby-better' : '';
            const worseClass = t.deltaVsHome < 0 ? ' nearby-worse' : '';
            const viewing =
              viewingLat != null &&
              viewingLon != null &&
              Math.abs(viewingLat - t.lat) < 0.02 &&
              Math.abs(viewingLon - t.lon) < 0.02;
            const score = showPercentages ? `${t.peakPct}%` : getEmoji(t.peakPct);
            return `
            <li>
              <button
                type="button"
                class="nearby-town${betterClass}${worseClass}${viewing ? ' nearby-viewing' : ''}"
                role="option"
                data-nearby-lat="${t.lat}"
                data-nearby-lon="${t.lon}"
                data-nearby-name="${escapeAttr(`${t.name}, ${region}`)}"
                data-rank="${i + 1}"
                ${viewing ? 'disabled' : ''}
              >
                <span class="nearby-town-rank">${i + 1}</span>
                <span class="nearby-town-main">
                  <strong>${escapeHtml(t.name)}</strong>
                  <span class="nearby-town-meta">${t.miles} mi · best ${escapeHtml(t.bestTimeLabel)}${viewing ? ' · viewing' : ''}</span>
                </span>
                <span class="nearby-town-score" style="color:${getScoreColor(t.peakPct)}">${score}</span>
                <span class="nearby-town-delta">${comparison}</span>
              </button>
            </li>`;
          })
          .join('');

  const list =
    result.towns.length === 0 && !home
      ? `<p class="nearby-popover-empty">No other towns found within ${NEARBY_MAX_MILES} miles.</p>`
      : `<ul class="nearby-list" role="listbox">${homeRow}${townRows}</ul>`;

  return `
    <div id="nearby-popover" class="nearby-popover" role="dialog" aria-label="Nearby towns">
      <div class="nearby-popover-head">
        <strong>Nearby towns</strong>
        <span>${escapeHtml(region)} · &lt;${NEARBY_MAX_MILES} mi</span>
      </div>
      <p class="nearby-popover-summary">${escapeHtml(summary)}${away ? ' · viewing a nearby town' : ''}</p>
      ${list}
      <p class="nearby-popover-note">Compared to your starting location · tap a town to preview · home stays fixed</p>
    </div>`;
}

export function positionNearbyPopover(): void {
  const pop = document.getElementById('nearby-popover');
  const anchor = document.querySelector('.nearby-control');
  if (!(pop instanceof HTMLElement) || !(anchor instanceof HTMLElement)) return;

  const rect = anchor.getBoundingClientRect();
  const width = Math.min(340, window.innerWidth - 16);
  let left = rect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  const top = Math.min(rect.bottom + 8, window.innerHeight - 120);

  pop.style.position = 'fixed';
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
  pop.style.right = 'auto';
  pop.style.width = `${width}px`;
  pop.style.zIndex = '600';
}
