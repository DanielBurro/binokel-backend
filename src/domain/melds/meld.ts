import type { Card } from '../cards/card';

/** Meldekatalog; Erkennung, Dominanzregeln und Punkte folgen mit Schritt 15. */
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

export type MeldId = string;

export interface Meld {
  /** Eindeutig unter den Meldungen eines Sitzes; `submitMelds` wählt darüber aus. */
  readonly id: MeldId;
  readonly kind: MeldKind;
  /** Karten, die mit der Meldung offengelegt werden. */
  readonly cards: readonly Card[];
  readonly points: number;
}
