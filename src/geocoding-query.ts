/** Build Open-Meteo geocoding query variants for messy user input. */

export interface GeocodingCandidate {
  query: string;
  countryCode?: string;
}

const US_STATES: Record<string, string> = {
  al: 'Alabama',
  alabama: 'Alabama',
  ak: 'Alaska',
  alaska: 'Alaska',
  az: 'Arizona',
  arizona: 'Arizona',
  ar: 'Arkansas',
  arkansas: 'Arkansas',
  ca: 'California',
  california: 'California',
  co: 'Colorado',
  colorado: 'Colorado',
  ct: 'Connecticut',
  connecticut: 'Connecticut',
  de: 'Delaware',
  delaware: 'Delaware',
  fl: 'Florida',
  florida: 'Florida',
  ga: 'Georgia',
  georgia: 'Georgia',
  hi: 'Hawaii',
  hawaii: 'Hawaii',
  id: 'Idaho',
  idaho: 'Idaho',
  il: 'Illinois',
  illinois: 'Illinois',
  in: 'Indiana',
  indiana: 'Indiana',
  ia: 'Iowa',
  iowa: 'Iowa',
  ks: 'Kansas',
  kansas: 'Kansas',
  ky: 'Kentucky',
  kentucky: 'Kentucky',
  la: 'Louisiana',
  louisiana: 'Louisiana',
  me: 'Maine',
  maine: 'Maine',
  md: 'Maryland',
  maryland: 'Maryland',
  ma: 'Massachusetts',
  massachusetts: 'Massachusetts',
  mi: 'Michigan',
  michigan: 'Michigan',
  mn: 'Minnesota',
  minnesota: 'Minnesota',
  ms: 'Mississippi',
  mississippi: 'Mississippi',
  mo: 'Missouri',
  missouri: 'Missouri',
  mt: 'Montana',
  montana: 'Montana',
  ne: 'Nebraska',
  nebraska: 'Nebraska',
  nv: 'Nevada',
  nevada: 'Nevada',
  nh: 'New Hampshire',
  'new hampshire': 'New Hampshire',
  nj: 'New Jersey',
  'new jersey': 'New Jersey',
  nm: 'New Mexico',
  'new mexico': 'New Mexico',
  ny: 'New York',
  'new york': 'New York',
  nc: 'North Carolina',
  'north carolina': 'North Carolina',
  nd: 'North Dakota',
  'north dakota': 'North Dakota',
  oh: 'Ohio',
  ohio: 'Ohio',
  ok: 'Oklahoma',
  oklahoma: 'Oklahoma',
  or: 'Oregon',
  oregon: 'Oregon',
  pa: 'Pennsylvania',
  pennsylvania: 'Pennsylvania',
  ri: 'Rhode Island',
  'rhode island': 'Rhode Island',
  sc: 'South Carolina',
  'south carolina': 'South Carolina',
  sd: 'South Dakota',
  'south dakota': 'South Dakota',
  tn: 'Tennessee',
  tennessee: 'Tennessee',
  tx: 'Texas',
  texas: 'Texas',
  ut: 'Utah',
  utah: 'Utah',
  vt: 'Vermont',
  vermont: 'Vermont',
  va: 'Virginia',
  virginia: 'Virginia',
  wa: 'Washington',
  washington: 'Washington',
  wv: 'West Virginia',
  'west virginia': 'West Virginia',
  wi: 'Wisconsin',
  wisconsin: 'Wisconsin',
  wy: 'Wyoming',
  wyoming: 'Wyoming',
  dc: 'District of Columbia',
  'district of columbia': 'District of Columbia',
};

/** Longest keys first so "puerto rico" wins over "co". */
const US_TERRITORIES: Array<{
  keys: string[];
  labels: string[];
  countryCode: string;
}> = [
  {
    keys: ['us virgin islands', 'u s virgin islands', 'usvi'],
    labels: ['VI', 'U.S. Virgin Islands'],
    countryCode: 'VI',
  },
  {
    keys: ['puerto rico'],
    labels: ['Puerto Rico'],
    countryCode: 'PR',
  },
  {
    keys: ['american samoa'],
    labels: ['American Samoa'],
    countryCode: 'AS',
  },
  {
    keys: ['northern mariana islands'],
    labels: ['Northern Mariana Islands'],
    countryCode: 'MP',
  },
  {
    keys: ['vi'],
    labels: ['VI', 'U.S. Virgin Islands'],
    countryCode: 'VI',
  },
  {
    keys: ['pr'],
    labels: ['Puerto Rico'],
    countryCode: 'PR',
  },
  {
    keys: ['gu', 'guam'],
    labels: ['Guam'],
    countryCode: 'GU',
  },
  {
    keys: ['as'],
    labels: ['American Samoa'],
    countryCode: 'AS',
  },
  {
    keys: ['mp', 'cnmi'],
    labels: ['Northern Mariana Islands'],
    countryCode: 'MP',
  },
];

const LEADING_ABBREVS: Record<string, string> = {
  ft: 'Fort',
  fort: 'Fort',
  st: 'Saint',
  ste: 'Sainte',
  mt: 'Mount',
  mount: 'Mount',
  pt: 'Point',
  lk: 'Lake',
};

/** USVI island names → Open-Meteo admin1 label. */
const USVI_ISLANDS: Record<string, string> = {
  'st thomas': 'Saint Thomas Island',
  'saint thomas': 'Saint Thomas Island',
  'st croix': 'Saint Croix Island',
  'saint croix': 'Saint Croix Island',
  'st john': 'Saint John Island',
  'saint john': 'Saint John Island',
};

const STATE_SUFFIX_WIDTHS = [3, 2, 1] as const;
const TERRITORY_SUFFIX_WIDTHS = [4, 3, 2, 1] as const;

function normalizeWhitespace(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

/** Strip punctuation quirks from user input before parsing. */
export function normalizeSearchQuery(rawQuery: string): string {
  return normalizeWhitespace(
    rawQuery
      .replace(/,/g, ' ')
      .replace(/\./g, '')
      .replace(/\bU\s*S\b/gi, 'US')
      .replace(/\s+/g, ' '),
  );
}

function expandLeadingAbbreviation(query: string): string {
  const parts = query.split(' ').filter(Boolean);
  if (parts.length === 0) return query;
  const first = parts[0].toLowerCase();
  const expanded = LEADING_ABBREVS[first];
  if (!expanded) return query;
  return [expanded, ...parts.slice(1)].join(' ');
}

function cityVariants(city: string): string[] {
  const variants = new Set<string>();
  const normalized = normalizeWhitespace(city);
  if (!normalized) return [];

  variants.add(normalized);
  const expanded = expandLeadingAbbreviation(normalized);
  variants.add(expanded);

  // St Thomas USVI only matches when expanded to Saint Thomas.
  if (/^st thomas\b/i.test(normalized)) {
    variants.add(normalized.replace(/^st\b/i, 'Saint'));
  }

  return [...variants];
}

function resolveUsState(token: string): string | null {
  return US_STATES[token.toLowerCase()] ?? null;
}

function matchUsTerritory(parts: string[]): { width: number; labels: string[]; countryCode: string } | null {
  const lowerParts = parts.map((p) => p.toLowerCase());

  for (const width of TERRITORY_SUFFIX_WIDTHS) {
    if (parts.length <= width) continue;
    const suffix = lowerParts.slice(-width).join(' ');
    for (const territory of US_TERRITORIES) {
      if (territory.keys.includes(suffix)) {
        return { width, labels: territory.labels, countryCode: territory.countryCode };
      }
    }
  }

  return null;
}

function splitCityAndState(query: string): { city: string; stateLabel: string } | null {
  const parts = query.split(' ').filter(Boolean);
  if (parts.length < 2) return null;

  for (const width of STATE_SUFFIX_WIDTHS) {
    if (parts.length <= width) continue;
    const stateTokens = parts.slice(-width);
    const stateKey = stateTokens.join(' ').toLowerCase();
    const stateLabel = resolveUsState(stateKey);
    if (!stateLabel) continue;

    const city = parts.slice(0, -width).join(' ').trim();
    if (!city) return null;

    const label = stateKey.length === 2 ? stateKey.toUpperCase() : stateLabel;
    return { city, stateLabel: label };
  }

  return null;
}

function splitCityAndTerritory(
  query: string,
): { city: string; labels: string[]; countryCode: string } | null {
  const parts = query.split(' ').filter(Boolean);
  if (parts.length < 2) return null;

  const match = matchUsTerritory(parts);
  if (!match) return null;

  const city = parts.slice(0, -match.width).join(' ').trim();
  if (!city) return null;

  return { city, labels: match.labels, countryCode: match.countryCode };
}

function usviIslandAdmin(city: string): string | null {
  return USVI_ISLANDS[city.toLowerCase()] ?? null;
}

function addCandidate(
  seen: Set<string>,
  candidates: GeocodingCandidate[],
  query: string,
  countryCode?: string,
): void {
  const trimmed = normalizeWhitespace(query);
  if (!trimmed) return;
  const key = `${trimmed.toLowerCase()}|${countryCode ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({ query: trimmed, countryCode });
}

/** Ordered unique geocoding queries to try, best guess first. */
export function buildGeocodingCandidates(rawQuery: string): GeocodingCandidate[] {
  const query = normalizeSearchQuery(rawQuery);
  if (!query) return [];

  const seen = new Set<string>();
  const candidates: GeocodingCandidate[] = [];
  const add = (value: string, countryCode?: string) => addCandidate(seen, candidates, value, countryCode);

  const territory = splitCityAndTerritory(query);
  const state = territory ? null : splitCityAndState(query);

  if (territory) {
    const { labels, countryCode } = territory;
    for (const city of cityVariants(territory.city)) {
      for (const label of labels) {
        add(`${city}, ${label}`, countryCode);
      }

      const island = countryCode === 'VI' ? usviIslandAdmin(city) : null;
      if (island) {
        add(`${city}, ${island}`, countryCode);
      }

      add(city, countryCode);
    }
  } else if (state) {
    for (const city of cityVariants(state.city)) {
      add(`${city}, ${state.stateLabel}`, 'US');
      add(city, 'US');
    }
  }

  const expanded = expandLeadingAbbreviation(query);
  add(query);
  if (expanded !== query) add(expanded);

  if (!territory && !state) {
    const expandedTerritory = splitCityAndTerritory(expanded);
    if (expandedTerritory) {
      const { labels, countryCode } = expandedTerritory;
      for (const city of cityVariants(expandedTerritory.city)) {
        for (const label of labels) {
          add(`${city}, ${label}`, countryCode);
        }
        const island = countryCode === 'VI' ? usviIslandAdmin(city) : null;
        if (island) add(`${city}, ${island}`, countryCode);
        add(city, countryCode);
      }
    } else {
      const expandedState = splitCityAndState(expanded);
      if (expandedState) {
        for (const city of cityVariants(expandedState.city)) {
          add(`${city}, ${expandedState.stateLabel}`, 'US');
          add(city, 'US');
        }
      }
    }
  }

  return candidates;
}
