export const SUITS = ['eichel', 'gruen', 'herz', 'schellen'] as const;
export type Suit = (typeof SUITS)[number];

/** Absteigend nach Stichstärke geordnet. */
export const RANKS = ['ass', 'zehn', 'koenig', 'ober', 'unter', 'sieben'] as const;
export type Rank = (typeof RANKS)[number];

export type CardCopy = 1 | 2;
export type CardId = string;

export interface Card {
  readonly id: CardId;
  readonly suit: Suit;
  readonly rank: Rank;
  /** Jede Karte existiert doppelt; das Exemplar unterscheidet beide. */
  readonly copy: CardCopy;
}

export const RANK_STRENGTH: Readonly<Record<Rank, number>> = {
  ass: 5,
  zehn: 4,
  koenig: 3,
  ober: 2,
  unter: 1,
  sieben: 0,
};

/** Augenwerte ω je Rang. */
export const RANK_EYES: Readonly<Record<Rank, number>> = {
  ass: 11,
  zehn: 10,
  koenig: 4,
  ober: 3,
  unter: 2,
  sieben: 0,
};

export function makeCard(suit: Suit, rank: Rank, copy: CardCopy): Card {
  return { id: `${suit}-${rank}-${copy}`, suit, rank, copy };
}

export function cardEyes(card: Card): number {
  return RANK_EYES[card.rank];
}
