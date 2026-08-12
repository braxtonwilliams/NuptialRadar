/**
 * Flight algorithm registry — production uses Forest v1 only.
 */
import { forestV1Algorithm } from './nuptials-forest-v1';
import type { FlightAlgorithm } from './types';

export const ALGORITHM_REGISTRY: FlightAlgorithm[] = [forestV1Algorithm];

export const DEFAULT_ALGORITHM_ID = forestV1Algorithm.id;

const STORAGE_KEY = 'nuptial-radar-algorithm';

export function getAlgorithmById(id: string): FlightAlgorithm | undefined {
  return ALGORITHM_REGISTRY.find((a) => a.id === id);
}

export function getActiveAlgorithm(): FlightAlgorithm {
  return forestV1Algorithm;
}

export function getActiveAlgorithmId(): string {
  return forestV1Algorithm.id;
}

/** No-op kept for startup cleanup of legacy saved hybrid IDs. */
export function loadSavedAlgorithmId(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved !== forestV1Algorithm.id) {
      localStorage.setItem(STORAGE_KEY, forestV1Algorithm.id);
    }
  } catch {
    /* ignore */
  }
}

export function listAlgorithms(): ReadonlyArray<{
  id: string;
  name: string;
  description: string;
  version: string;
}> {
  return ALGORITHM_REGISTRY.map(({ id, name, description, version }) => ({
    id,
    name,
    description,
    version,
  }));
}

export { forestV1Algorithm };
export { LITERATURE_STUDIES, LITERATURE_PARAMS } from './references';
