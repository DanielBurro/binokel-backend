import type { Card } from '../cards/card';

/** Meldekatalog der Studienarbeit (Tabelle „Meldekombinationen“), abgeglichen am 25.11.2026. */
export const MELD_KINDS = [
  'paar',
  'familie',
  'doppelteFamilie',
  'binokel',
  'doppelBinokel',
  'vierGleiche',
  'achtGleiche',
  'diss',
] as const;
export type MeldKind = (typeof MELD_KINDS)[number];

/**
 * Gruppenregel: Eine Karte darf in Meldungen verschiedener Gruppen stecken, innerhalb einer
 * Gruppe aber nur in einer.
 */
export const MELD_GROUPS = ['satz', 'sequenz', 'spezial'] as const;
export type MeldGroup = (typeof MELD_GROUPS)[number];

export const MELD_GROUP: Readonly<Record<MeldKind, MeldGroup>> = {
  vierGleiche: 'satz',
  achtGleiche: 'satz',
  paar: 'sequenz',
  familie: 'sequenz',
  doppelteFamilie: 'sequenz',
  binokel: 'spezial',
  doppelBinokel: 'spezial',
  diss: 'spezial',
};

export type MeldId = string;

export interface Meld {
  /** Eindeutig unter den Meldungen eines Sitzes; `submitMelds` wählt darüber aus. */
  readonly id: MeldId;
  readonly kind: MeldKind;
  /** Karten, die mit der Meldung offengelegt werden. */
  readonly cards: readonly Card[];
  readonly points: number;
}

export function meldPoints(melds: readonly Meld[]): number {
  return melds.reduce((sum, meld) => sum + meld.points, 0);
}
