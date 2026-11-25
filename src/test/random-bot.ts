import { SUITS, type Card } from '../domain/cards/card';
import type { Seat } from '../domain/rules/parties';
import type { GameState } from '../domain/state/game-state';
import type { LegalIntent, PlayerIntent } from '../domain/state/intents';
import { legalIntents } from '../domain/state/legal-intents';

/**
 * Zufalls-Bot für den Simulationstest (Planschritt 32). Reines Testwerkzeug, kein Produktfeature:
 * Er wählt nur aus dem, was `legalIntents` anbietet, und ist über den Seed reproduzierbar.
 */

/** Liefert eine ganze Zahl in [0, bound). */
export type Random = (bound: number) => number;

/** Mulberry32: klein, schnell und deterministisch; für Tests genügt das. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return (bound) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const unit = ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    return Math.floor(unit * bound);
  };
}

/** Fisher-Yates mit der Test-Zufallsquelle statt `crypto.randomInt`. */
export function shuffle<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Macht aus einem angebotenen Zug einen konkreten, zufällig innerhalb seines Spielraums. */
export function concretize(
  legal: LegalIntent,
  hand: readonly Card[],
  random: Random,
): PlayerIntent {
  switch (legal.type) {
    case 'bid': {
      const choices = (legal.max - legal.min) / legal.step + 1;
      return { type: 'bid', amount: legal.min + random(choices) * legal.step };
    }
    case 'pass':
      return { type: 'pass' };
    case 'takeDabb':
      return { type: 'takeDabb' };
    case 'discardToDabb': {
      const cardIds = shuffle(hand, random)
        .slice(0, legal.count)
        .map((card) => card.id);
      return { type: 'discardToDabb', cardIds };
    }
    case 'declare':
      return {
        type: 'declare',
        trump: SUITS[random(SUITS.length)],
        mode: legal.modes[random(legal.modes.length)],
      };
    case 'submitMelds':
      // Jede Meldung des Vorschlags mit halber Wahrscheinlichkeit, also auch mal keine.
      return {
        type: 'submitMelds',
        meldIds: legal.melds.filter(() => random(2) === 1).map((meld) => meld.id),
      };
    case 'playCard':
      return { type: 'playCard', cardId: legal.cardIds[random(legal.cardIds.length)] };
    case 'readyForNextRound':
      return { type: 'readyForNextRound' };
  }
}

/** Der Sitz am Zug und ein zufälliger erlaubter Zug; null, wenn niemand etwas tun kann. */
export function chooseMove(
  state: GameState,
  random: Random,
): { readonly seat: Seat; readonly intent: PlayerIntent } | null {
  for (let seat = 0; seat < state.config.playerCount; seat++) {
    const offers = legalIntents(state, seat);
    if (offers.length === 0) continue;
    const hand = state.round?.hands[seat] ?? [];
    return { seat, intent: concretize(offers[random(offers.length)], hand, random) };
  }
  return null;
}
