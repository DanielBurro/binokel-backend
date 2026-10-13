import type { DeckSize } from '../config/game-config';
import { RANKS, SUITS, makeCard, type Card, type CardCopy, type Rank } from './card';

const COPIES: readonly CardCopy[] = [1, 2];

/** Das 40er-Blatt kommt ohne Siebener aus. */
export function ranksForDeck(deckSize: DeckSize): readonly Rank[] {
  return deckSize === 48 ? RANKS : RANKS.filter((rank) => rank !== 'sieben');
}

export function buildDeck(deckSize: DeckSize): Card[] {
  const ranks = ranksForDeck(deckSize);
  return SUITS.flatMap((suit) =>
    ranks.flatMap((rank) => COPIES.map((copy) => makeCard(suit, rank, copy))),
  );
}
