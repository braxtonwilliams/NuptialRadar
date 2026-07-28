import type { LiteratureStudy } from './types';

/**
 * Published studies and meta-analyses used to parameterise the hybrid v2 scorer.
 * The production v1 algorithm uses the nuptialflight random-forest models only;
 * v2 blends those models with the literature-derived terms below.
 */
export const LITERATURE_STUDIES: LiteratureStudy[] = [
  {
    id: 'boomsma1981',
    authors: 'Boomsma & Leusink',
    year: 1981,
    title: 'Weather conditions during nuptial flights of four European ant species',
    journal: 'Oecologia 50:236–241',
    url: 'https://antwiki.org/wiki/images/d/dd/Boomsma%2C_J.J.%2C_Leusink%2C_A._1981._Weather_conditions_during_nuptial_flights_of_four_European_ant_species_.pdf',
    findings: [
      'Lasius niger, L. flavus, Myrmica rubra, and M. scabrinodis fly on warm, humid days with low wind.',
      'Larger-bodied Lasius queens require higher air temperatures than smaller Myrmica queens.',
      'Rain and humidity are common antecedents; flights often follow precipitation events.',
    ],
  },
  {
    id: 'depa2006',
    authors: 'Depa',
    year: 2006,
    title: 'Weather conditions during nuptial flight of Manica rubida in southern Poland',
    journal: 'Myrmecological News 9:27–32',
    url: 'https://antwiki.org/wiki/images/5/50/Depa%2C_L._2006._Weather_conditions_during_nuptial_flight_of_Manica_rubida.pdf',
    findings: [
      'Flights clustered on days with elevated temperature and humidity versus preceding days.',
      'Low wind speed and overcast-to-broken cloud cover frequently accompanied flights.',
      'Supports temperature + humidity + calm-air synergy for temperate Formicinae.',
    ],
  },
  {
    id: 'sobczak2017',
    authors: 'Sobczak et al.',
    year: 2017,
    title: 'The spatial distribution and environmental triggers of ant mating flights (citizen science, UK)',
    journal: 'Ecography',
    url: 'https://onlinelibrary.wiley.com/doi/epdf/10.1111/ecog.03140',
    findings: [
      'Mating flights reported when mean temperature exceeded ~25 °C nationally.',
      'Wind speeds during flights typically remained below 6.3 m/s.',
      'Geography and season modulate timing beyond raw temperature alone.',
    ],
  },
  {
    id: 'dunn2007',
    authors: 'Dunn et al.',
    year: 2007,
    title: 'Reproductive phenologies in a diverse temperate ant fauna',
    journal: 'Ecological Entomology 32:135–141',
    findings: [
      'Species-specific seasonal windows; summer peaks dominate temperate zones.',
      'Weather acts as a gate on genetically programmed seasonal readiness.',
    ],
  },
  {
    id: 'messer2009',
    authors: 'Messer et al.',
    year: 2009,
    title: 'Nuptial flights of Messor barbarus in the Iberian Peninsula',
    journal: 'Myrmecological News / UDG repository',
    url: 'https://dugi-doc.udg.edu/handle/10256/11940',
    findings: [
      'Peak flight days often occurred 2–3 days after rain fronts cleared.',
      'Synchrony across hundreds of km when post-front calm warm weather returned.',
    ],
  },
  {
    id: 'wilson1955',
    authors: 'Wilson',
    year: 1955,
    title: 'Lasius neoniger nuptial flights after rainfall (summarised on AntWiki)',
    url: 'https://antwiki.org/wiki/Nuptial_Flights_and_Mating',
    findings: [
      'Flights commonly within 24 h of moderate/heavy rain on warm, humid, low-wind afternoons.',
      'Moist soil reduces queen desiccation and aids nest excavation.',
    ],
  },
  {
    id: 'nuptialflight2026',
    authors: 'Rushworth / nuptialflight',
    year: 2026,
    title: 'Random-forest models trained on crowd-sourced flight + weather database',
    journal: 'github.com/bradrushworth/nuptialflight',
    url: 'https://github.com/bradrushworth/nuptialflight',
    findings: [
      '212k+ labelled flight rows; cyclical DOY, hemisphere, dew-point depression, antecedent rain improve AUC.',
      'Hard gates: temp < 5 °C, wind > 15 m/s, gust > 20 m/s → near-zero probability.',
    ],
  },
];

/** Literature-consensus parameter ranges used by the v2 scorer (see module docstrings). */
export const LITERATURE_PARAMS = {
  temp: { min: 5, softMin: 15, optimal: 22, softMax: 28, hardMax: 35 },
  humidity: { min: 45, optimal: 78, max: 100 },
  wind: { optimal: 2.5, softMax: 6.3, hardMax: 15 },
  gust: { softMax: 12, hardMax: 20 },
  dewDepression: { optimal: 3, softMax: 8 },
  /** Probability of rain during the flight hour — lower is better. */
  rainPopFlight: { softMax: 0.25, hardMax: 0.6 },
  /** Antecedent rain amount (mm) in prior 1–3 days — moderate boost. */
  antecedentRainMm: { softMin: 0.5, optimal: 4, softMax: 20 },
  /** Local hour windows (24h clock) for diurnal temperate flyers. */
  diurnalHours: [{ start: 10, end: 14 }, { start: 17, end: 21 }] as const,
  /** UK/European Lasius-style high-temperature boost threshold (Sobczak 2017). */
  highTempBoost: 25,
} as const;
