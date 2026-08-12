/**
 * Major New World / US + Caribbean ant genera with typical nuptial-flight windows.
 * Profiles are field-guide / literature consensus for genera — not exhaustive taxonomy.
 *
 * Seasonality is defined as a northern-hemisphere peak window with ramp/fade shoulders
 * (day-of-year). Month chips are sampled from that continuous curve.
 */
import {
  CARIBBEAN,
  NORTH_AMERICA,
  US_GULF_CARIBBEAN_STATES,
  US_NORTH,
  US_SOUTHEAST,
  US_SOUTHWEST,
  US_TEMPERATE,
  placePresentInRange,
  type LocationPlace,
  type SpeciesRange,
} from './range';

export type SizeClass = 'small' | 'medium' | 'large';

export interface RainLagHours {
  softMin: number;
  optimal: number;
  softMax: number;
}

/**
 * Northern-hemisphere flight season on the civil day-of-year calendar (1=Jan 1 … 365=Dec 31, non-leap).
 * Southern latitudes shift the evaluation DOY by ~6 months in timing.ts.
 */
export interface FlightSeason {
  /** Inclusive peak start (day of year). */
  peakStart: number;
  /** Inclusive peak end (day of year). */
  peakEnd: number;
  /** Days before peakStart climbing 0 → 1. */
  rampDays: number;
  /** Days after peakEnd falling 1 → 0. */
  fadeDays: number;
}

export interface SpeciesProfile {
  id: string;
  genus: string;
  commonName: string;
  aliases: string[];
  sizeClass: SizeClass;
  /** Continuous N-hemisphere season curve source of truth. */
  season: FlightSeason;
  /**
   * Mid-month samples of `season` (0..1) for ℹ UI chips.
   * Indexed 0=Jan … 11=Dec (northern); display shifts for southern elsewhere if needed.
   */
  monthWeights: number[];
  /** Local hour weights indexed 0..23 (0..1). */
  hourWeights: number[];
  rainLagHours: RainLagHours;
  range: SpeciesRange;
  conditionsSummary: string;
  flightPatternNotes: string;
  sources: string[];
}

/** Day-of-year for month (1–12) + day on a non-leap calendar. */
export function dayOfYearFromMonthDay(month: number, day: number): number {
  const mdays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let doy = day;
  for (let i = 0; i < month - 1; i++) doy += mdays[i];
  return doy;
}

/** Day-of-year (1–365/366) from a Date using UTC parts (local wall clock when using offset-shifted Date). */
export function dayOfYearFromDate(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86400000);
}

/** Ease-in/out smoothstep for shoulder ramps (still 0 at edges, 1 at peak boundary). */
function smooth01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Continuous season factor on northern DOY for a FlightSeason window.
 * Before ramp → 0; through peak → 1; after fade → 0.
 */
export function seasonFactorForDoy(season: FlightSeason, doy: number): number {
  const { peakStart, peakEnd, rampDays, fadeDays } = season;
  const d = ((Math.round(doy) - 1) % 365 + 365) % 365 + 1;

  if (d >= peakStart && d <= peakEnd) return 1;

  if (rampDays > 0) {
    const rampStart = peakStart - rampDays;
    if (d > rampStart && d < peakStart) {
      return smooth01((d - rampStart) / rampDays);
    }
  }

  if (fadeDays > 0) {
    const fadeEnd = peakEnd + fadeDays;
    if (d > peakEnd && d < fadeEnd) {
      return smooth01(1 - (d - peakEnd) / fadeDays);
    }
  }

  return 0;
}

/** Mid-month DOYs (non-leap) for UI chips. */
const MID_MONTH_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

export function monthWeightsFromSeason(season: FlightSeason): number[] {
  return MID_MONTH_DOY.map((doy) => seasonFactorForDoy(season, doy));
}

function season(peakStart: number, peakEnd: number, rampDays: number, fadeDays: number): FlightSeason {
  return { peakStart, peakEnd, rampDays, fadeDays };
}

/** Convenience: month/day → DOY for catalog definitions. */
function md(month: number, day: number): number {
  return dayOfYearFromMonthDay(month, day);
}

/** Build a 24-length hour weight array from peak windows (full=1, shoulder=0.55, else=0.15). */
function hoursFromWindows(peaks: Array<{ start: number; end: number }>, shoulder = 1): number[] {
  const w = new Array<number>(24).fill(0.15);
  for (const { start, end } of peaks) {
    for (let h = 0; h < 24; h++) {
      if (h >= start && h <= end) w[h] = 1;
      else if (h >= start - shoulder && h <= end + shoulder) w[h] = Math.max(w[h], 0.55);
    }
  }
  return w;
}

function profile(
  partial: Omit<SpeciesProfile, 'monthWeights'> & { season: FlightSeason },
): SpeciesProfile {
  return {
    ...partial,
    monthWeights: monthWeightsFromSeason(partial.season),
  };
}

export const SPECIES_CATALOG: SpeciesProfile[] = [
  profile({
    id: 'camponotus',
    genus: 'Camponotus',
    commonName: 'Carpenter ants',
    aliases: ['carpenter', 'carpenter ant', 'camponotus pennsylvanicus'],
    sizeClass: 'large',
    // Peak May–Jul; spring ramp, late-summer fade into September
    season: season(md(5, 1), md(7, 31), 25, 35),
    hourWeights: hoursFromWindows([{ start: 16, end: 21 }], 2),
    rainLagHours: { softMin: 6, optimal: 24, softMax: 72 },
    range: {
      countryCodes: [...NORTH_AMERICA],
      latMin: 7,
      latMax: 65,
      presence: 'native',
      presenceNote: 'Widespread native carpenter ants across North America and the Caribbean.',
    },
    conditionsSummary:
      'Warm late-spring through summer evenings after humid days; often after rain has cleared.',
    flightPatternNotes:
      'Large Camponotus queens typically fly from late afternoon into evening in late spring and summer. Flights favor calm, humid evenings and often follow a rain event by about a day. Peak northern months are May–July.',
    sources: [
      'Field guides / US antkeeper consensus for Camponotus',
      'Boomsma & Leusink 1981 — larger ants prefer warmer flight temps',
    ],
  }),
  profile({
    id: 'solenopsis',
    genus: 'Solenopsis',
    commonName: 'Fire ants',
    aliases: ['fire ant', 'fire ants', 'red imported fire ant', 'riffa', 's. invicta'],
    sizeClass: 'small',
    // Long warm-season peak Apr–Oct; short shoulders
    season: season(md(4, 1), md(10, 15), 15, 20),
    hourWeights: hoursFromWindows([{ start: 10, end: 16 }], 2),
    rainLagHours: { softMin: 2, optimal: 12, softMax: 48 },
    range: {
      countryCodes: ['US', 'MX', ...CARIBBEAN],
      usStates: [...US_SOUTHEAST, 'CA', 'NM', 'AZ'],
      latMin: 10,
      latMax: 38,
      presence: 'established',
      presenceNote:
        'Includes native thief ants and invasive red imported fire ants (S. invicta) in the southern US and Caribbean.',
    },
    conditionsSummary:
      'Warm to hot days shortly after rain; midday flights common in southern US and Caribbean.',
    flightPatternNotes:
      'Solenopsis (including fire ants) often swarm after rain on warm days, commonly from late morning through mid-afternoon. Long season in warm climates (spring–fall). Humid air and clearing skies after showers are classic triggers.',
    sources: [
      'US fire-ant extension guidance (post-rain mating flights)',
      'Wilson 1955 — Lasius-style post-rain pattern also reported for Solenopsis swarms',
    ],
  }),
  profile({
    id: 'crematogaster',
    genus: 'Crematogaster',
    commonName: 'Acrobat ants',
    aliases: ['acrobat', 'acrobat ant', 'acrobat ants'],
    sizeClass: 'small',
    season: season(md(5, 15), md(8, 31), 20, 25),
    hourWeights: hoursFromWindows([{ start: 12, end: 18 }], 2),
    rainLagHours: { softMin: 4, optimal: 18, softMax: 60 },
    range: {
      countryCodes: [...NORTH_AMERICA],
      latMin: 10,
      latMax: 50,
      presence: 'native',
      presenceNote: 'Native acrobat ants throughout much of the US, Mexico, and Caribbean.',
    },
    conditionsSummary: 'Warm afternoons in late spring and summer; moderate winds only.',
    flightPatternNotes:
      'Crematogaster flights concentrate in warm afternoons during the summer peak. Many keepers report midday–late afternoon windows after humid mornings. Season is shorter than Solenopsis in temperate zones.',
    sources: ['US acrobat-ant field notes / antkeeper seasonal logs'],
  }),
  profile({
    id: 'pheidole',
    genus: 'Pheidole',
    commonName: 'Big-headed ants',
    aliases: ['big headed', 'big-headed ant', 'bigheaded'],
    sizeClass: 'small',
    season: season(md(4, 15), md(9, 15), 20, 25),
    hourWeights: hoursFromWindows([{ start: 17, end: 22 }], 2),
    rainLagHours: { softMin: 6, optimal: 20, softMax: 72 },
    range: {
      countryCodes: ['US', 'MX', ...CARIBBEAN],
      usStates: [...US_SOUTHEAST, 'AZ', 'CA', 'NM', 'NV'],
      latMin: 10,
      latMax: 40,
      presence: 'established',
      presenceNote: 'Mostly southern / subtropical; some invasive Pheidole in warm US regions.',
    },
    conditionsSummary: 'Warm humid evenings; tropical and subtropical species fly much of the year.',
    flightPatternNotes:
      'Many Pheidole species fly in the evening after warm days. In the Caribbean and southern US, the season stretches longer; temperate species peak May–August. Rain-clearing evenings are favorable.',
    sources: ['New World Pheidole flight timing (field / keeper consensus)'],
  }),
  profile({
    id: 'formica',
    genus: 'Formica',
    commonName: 'Wood ants / thatching ants',
    aliases: ['wood ant', 'thatching ant', 'formica rufa'],
    sizeClass: 'medium',
    // Earlier peak May–mid Jul; fades through late summer
    season: season(md(5, 1), md(7, 15), 20, 25),
    hourWeights: hoursFromWindows([{ start: 9, end: 14 }], 2),
    rainLagHours: { softMin: 12, optimal: 36, softMax: 96 },
    range: {
      countryCodes: ['US', 'CA'],
      usStates: [...US_TEMPERATE, 'AK'],
      latMin: 32,
      latMax: 70,
      presence: 'native',
      presenceNote: 'Cool–temperate wood ants; not established in tropical Caribbean lowlands.',
    },
    conditionsSummary: 'Cool–mild late spring mornings; avoid strong wind and active rain.',
    flightPatternNotes:
      'Formica often fly earlier in the year than Camponotus, with morning to early-afternoon peaks in May–June (northern). Prefer settled weather a day or more after rain rather than immediate post-storm flights.',
    sources: ['Boomsma & Leusink 1981 — temperate Formicinae phenology', 'European wood-ant flight notes'],
  }),
  profile({
    id: 'lasius',
    genus: 'Lasius',
    commonName: 'Citronella / black garden ants',
    aliases: ['citronella ant', 'garden ant', 'lasius niger', 'lasius neoniger'],
    sizeClass: 'small',
    // Classic midsummer: peak mid-Jun–Aug; June ramp, Sept fade (not a cliff)
    season: season(md(6, 15), md(8, 31), 28, 32),
    hourWeights: hoursFromWindows(
      [
        { start: 10, end: 14 },
        { start: 16, end: 19 },
      ],
      1,
    ),
    rainLagHours: { softMin: 4, optimal: 24, softMax: 72 },
    range: {
      countryCodes: ['US', 'CA'],
      usStates: [...US_TEMPERATE, ...US_NORTH, 'AK'],
      latMin: 30,
      latMax: 65,
      presence: 'native',
      presenceNote: 'Temperate northern genus (e.g. L. neoniger); scarce or absent in tropical islands.',
    },
    conditionsSummary: 'Humid midsummer days; classic “flying ant day” after rain in temperate zones.',
    flightPatternNotes:
      'Lasius is the classic midsummer nuptial-flight genus in the northern hemisphere (June–August). Twin peaks often appear late morning and late afternoon. Wilson (1955) and European citizen science (Sobczak 2017) emphasize humidity and post-rain clearing.',
    sources: [
      'Wilson 1955 — Lasius neoniger after rainfall',
      'Sobczak et al. 2017 — UK citizen-science weather windows',
      'Boomsma & Leusink 1981 — Lasius niger / flavus',
    ],
  }),
  profile({
    id: 'myrmica',
    genus: 'Myrmica',
    commonName: 'Red ants',
    aliases: ['myrmica rubra', 'red ant'],
    sizeClass: 'small',
    season: season(md(6, 1), md(8, 20), 20, 25),
    hourWeights: hoursFromWindows([{ start: 14, end: 19 }], 2),
    rainLagHours: { softMin: 8, optimal: 30, softMax: 90 },
    range: {
      countryCodes: ['US', 'CA'],
      usStates: [...US_NORTH, 'CO', 'UT', 'WA', 'OR', 'ID', 'MT', 'WY', 'AK'],
      latMin: 38,
      latMax: 70,
      presence: 'established',
      presenceNote: 'Cool northern / montane; includes invasive M. rubra in parts of the Northeast.',
    },
    conditionsSummary: 'Mild humid afternoons; flies at cooler temperatures than large Formicinae.',
    flightPatternNotes:
      'Myrmica often flies on milder humid afternoons in summer. Boomsma & Leusink note smaller Myrmica tolerating cooler flight temperatures than larger Lasius. Season centers on June–August in the north.',
    sources: ['Boomsma & Leusink 1981 — Myrmica rubra / scabrinodis'],
  }),
  profile({
    id: 'pogonomyrmex',
    genus: 'Pogonomyrmex',
    commonName: 'Harvester ants',
    aliases: ['harvester', 'harvester ant', 'pogos'],
    sizeClass: 'medium',
    season: season(md(5, 1), md(8, 31), 20, 25),
    hourWeights: hoursFromWindows([{ start: 9, end: 13 }], 2),
    rainLagHours: { softMin: 12, optimal: 48, softMax: 120 },
    range: {
      countryCodes: ['US', 'MX'],
      usStates: [...US_SOUTHWEST, 'KS', 'NE', 'SD', 'ND', 'MT', 'WY', 'ID', 'OR'],
      latMin: 20,
      latMax: 50,
      lonMin: -125,
      lonMax: -93,
      presence: 'native',
      presenceNote: 'Western / southwestern arid harvester ants; not Caribbean.',
    },
    conditionsSummary: 'Warm dry mornings in arid and semi-arid regions; less tied to immediate rain.',
    flightPatternNotes:
      'Harvester ants in the western / southwestern US often fly on warm clear mornings in late spring and summer. Rain lag is longer — they favor dried soils after storms rather than immediate post-rain swarms.',
    sources: ['Southwestern US harvester-ant flight notes'],
  }),
  profile({
    id: 'trachymyrmex',
    genus: 'Trachymyrmex',
    commonName: 'Fungus-growing ants',
    aliases: ['fungus ant', 'fungus-growing', 'attine'],
    sizeClass: 'medium',
    // Long southern / Caribbean season
    season: season(md(3, 15), md(10, 31), 20, 25),
    hourWeights: hoursFromWindows([{ start: 19, end: 23 }], 2),
    rainLagHours: { softMin: 3, optimal: 14, softMax: 48 },
    range: {
      countryCodes: ['US', 'MX', ...CARIBBEAN],
      usStates: [...US_SOUTHEAST, 'AZ', 'NM'],
      latMin: 10,
      latMax: 37,
      presence: 'native',
      presenceNote: 'Southeastern US, Mexico, and Caribbean fungus growers.',
    },
    conditionsSummary: 'Warm humid nights after rain; strong in southeastern US and Caribbean.',
    flightPatternNotes:
      'Trachymyrmex and related fungus growers often fly at night or dusk after rain in warm humid climates. Season is long in the south and Caribbean (spring through fall).',
    sources: ['Southeastern / Caribbean attine flight observations'],
  }),
  profile({
    id: 'tetramorium',
    genus: 'Tetramorium',
    commonName: 'Pavement ants',
    aliases: ['pavement ant', 'pavement ants', 'tetramorium immigrans'],
    sizeClass: 'small',
    season: season(md(6, 10), md(8, 25), 25, 30),
    hourWeights: hoursFromWindows([{ start: 11, end: 16 }], 2),
    rainLagHours: { softMin: 6, optimal: 24, softMax: 72 },
    range: {
      countryCodes: ['US', 'CA'],
      usStates: [...US_TEMPERATE, ...US_NORTH],
      latMin: 32,
      latMax: 55,
      presence: 'invasive',
      presenceNote: 'Invasive pavement ants (T. immigrans) in temperate urban North America.',
    },
    conditionsSummary: 'Warm midsummer days; urban sidewalks after humid weather.',
    flightPatternNotes:
      'Pavement ants (Tetramorium) typically fly on warm midsummer days, often midday to mid-afternoon. Common around human structures. Peak June–August in temperate North America.',
    sources: ['Urban Tetramorium immigrans flight timing (keeper / extension notes)'],
  }),
  profile({
    id: 'brachymyrmex',
    genus: 'Brachymyrmex',
    commonName: 'Rover ants',
    aliases: ['rover ant', 'rover ants'],
    sizeClass: 'small',
    season: season(md(3, 1), md(11, 15), 20, 25),
    hourWeights: hoursFromWindows([{ start: 18, end: 23 }], 2),
    rainLagHours: { softMin: 2, optimal: 10, softMax: 36 },
    range: {
      countryCodes: ['US', 'MX', ...CARIBBEAN],
      usStates: [...US_GULF_CARIBBEAN_STATES, 'AR', 'OK', 'NC', 'TN', 'AZ', 'CA'],
      latMin: 10,
      latMax: 36,
      presence: 'established',
      presenceNote: 'Native Neotropical rover ants; invasive/expanding in Gulf Coast and Florida.',
    },
    conditionsSummary: 'Warm humid evenings shortly after rain; Florida / Gulf / Caribbean.',
    flightPatternNotes:
      'Tiny Brachymyrmex (“rover ants”) often fly at dusk/night soon after rain in warm coastal climates. Long season in the Southeast and Caribbean.',
    sources: ['Gulf Coast / Caribbean Brachymyrmex flight notes'],
  }),
  profile({
    id: 'dorymyrmex',
    genus: 'Dorymyrmex',
    commonName: 'Pyramid ants',
    aliases: ['pyramid ant', 'pyramid ants'],
    sizeClass: 'small',
    season: season(md(4, 1), md(8, 31), 20, 25),
    hourWeights: hoursFromWindows([{ start: 8, end: 12 }], 2),
    rainLagHours: { softMin: 8, optimal: 30, softMax: 84 },
    range: {
      countryCodes: ['US', 'MX', ...CARIBBEAN],
      usStates: [...US_SOUTHEAST, ...US_SOUTHWEST],
      latMin: 10,
      latMax: 40,
      presence: 'native',
      presenceNote: 'Open-habitat pyramid ants of the southern US, Mexico, and Caribbean.',
    },
    conditionsSummary: 'Warm sunny mornings; open sandy or disturbed habitats.',
    flightPatternNotes:
      'Dorymyrmex (pyramid ants) often fly on warm sunny mornings in spring and summer. Less tied to immediate post-rain swarms than Solenopsis; prefer settled fair mornings.',
    sources: ['Southeastern US Dorymyrmex field notes'],
  }),
];

const byId = new Map(SPECIES_CATALOG.map((s) => [s.id, s]));

export function getSpeciesById(id: string | null | undefined): SpeciesProfile | null {
  if (!id) return null;
  return byId.get(id) ?? null;
}

export function listSpecies(place?: LocationPlace | null): readonly SpeciesProfile[] {
  if (!place) return SPECIES_CATALOG;
  return SPECIES_CATALOG.filter((s) => placePresentInRange(place, s.range));
}

export function speciesPresentAt(species: SpeciesProfile, place: LocationPlace | null | undefined): boolean {
  if (!place) return true;
  return placePresentInRange(place, species.range);
}

/**
 * Season activity 0..1 for a genus at a local date.
 * Southern hemisphere shifts the evaluation DOY by ~182 days.
 */
export function seasonFactor(profile: SpeciesProfile, lat: number, date: Date): number {
  let doy = dayOfYearFromDate(date);
  if (lat < 0) {
    doy = ((doy - 1 + 182) % 365) + 1;
  }
  return seasonFactorForDoy(profile.season, doy);
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Ranked autocomplete matches against genus, common name, and aliases (location-filtered). */
export function searchSpecies(
  query: string,
  limit = 8,
  place?: LocationPlace | null,
): SpeciesProfile[] {
  const pool = listSpecies(place);
  const q = normalizeQuery(query);
  if (!q) return pool.slice(0, limit);

  const scored = pool.map((s) => {
    const genus = s.genus.toLowerCase();
    const common = s.commonName.toLowerCase();
    const aliasHit = s.aliases.some((a) => a.toLowerCase().includes(q));
    let score = 0;
    if (genus === q || common === q) score = 100;
    else if (genus.startsWith(q)) score = 90;
    else if (common.startsWith(q)) score = 80;
    else if (genus.includes(q)) score = 70;
    else if (common.includes(q)) score = 60;
    else if (aliasHit) score = 50;
    return { s, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.genus.localeCompare(b.s.genus));

  return scored.slice(0, limit).map((x) => x.s);
}

/** Best single Tab-completion candidate from current query. */
export function tabCompleteSpecies(
  query: string,
  place?: LocationPlace | null,
): SpeciesProfile | null {
  const matches = searchSpecies(query, 1, place);
  return matches[0] ?? null;
}
