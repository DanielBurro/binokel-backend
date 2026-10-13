import type { Card } from '../cards/card';
import { dealPattern, type DealConfig } from '../config/deal-pattern';
import type { PlayerCount } from '../config/game-config';
import { assertSeat, type Seat } from './parties';

export interface DealResult {
  /** Nach Sitz indiziert. */
  readonly hands: readonly (readonly Card[])[];
  readonly dabb: readonly Card[];
}

export function forehandOf(dealer: Seat, playerCount: PlayerCount): Seat {
  return (dealer + 1) % playerCount;
}

/** Verteilt ein bereits gemischtes Blatt ab Vorhand nach dem Muster der Konfiguration. */
export function deal(shuffledDeck: readonly Card[], config: DealConfig, dealer: Seat): DealResult {
  const { playerCount, deckSize } = config;
  assertSeat(dealer, playerCount);
  if (shuffledDeck.length !== deckSize) {
    throw new RangeError(`Blatt hat ${shuffledDeck.length} statt ${deckSize} Karten`);
  }

  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  const dabb: Card[] = [];
  const forehand = forehandOf(dealer, playerCount);
  let next = 0;

  const take = (count: number): Card[] => {
    const cards = shuffledDeck.slice(next, next + count);
    next += count;
    return cards;
  };

  for (const step of dealPattern(config)) {
    if (step.target === 'dabb') {
      dabb.push(...take(step.count));
      continue;
    }
    for (let offset = 0; offset < playerCount; offset++) {
      hands[(forehand + offset) % playerCount].push(...take(step.count));
    }
  }

  return { hands, dabb };
}
