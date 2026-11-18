import { cardEyes, type CardId } from '../cards/card';
import type { Seat } from '../rules/parties';
import type { RoundState } from './game-state';
import { fail, type GameEvent, type IntentFailure } from './intents';

export type DabbResult =
  | { readonly ok: true; readonly round: RoundState; readonly events: readonly GameEvent[] }
  | IntentFailure;

/** Der Spielmacher nimmt den Dabb auf die Hand. Die Phase prüft der Aufrufer. */
export function takeDabb(round: RoundState, seat: Seat): DabbResult {
  if (seat !== round.declarer) return fail('NOT_YOUR_TURN');
  if (round.dabbStatus !== 'table') return fail('DABB_ALREADY_TAKEN');

  const hands = round.hands.map((hand, index) =>
    index === seat ? [...hand, ...round.dabb] : hand,
  );
  return {
    ok: true,
    round: { ...round, hands, dabbStatus: 'taken' },
    events: [{ type: 'dabbTaken', seat }],
  };
}

/**
 * Der Spielmacher drückt genau so viele verschiedene Handkarten, wie der Dabb hatte. Welche,
 * entscheidet er frei; auch eben aufgenommene Karten darf er zurücklegen.
 */
export function discardToDabb(
  round: RoundState,
  seat: Seat,
  cardIds: readonly CardId[],
): DabbResult {
  if (seat !== round.declarer) return fail('NOT_YOUR_TURN');
  if (round.dabbStatus !== 'taken') return fail('DABB_NOT_TAKEN');
  if (cardIds.length !== round.dabb.length) return fail('WRONG_DISCARD_COUNT');
  const chosen = new Set(cardIds);
  if (chosen.size !== cardIds.length) return fail('DUPLICATE_CARDS');

  const hand = round.hands[seat];
  if (cardIds.some((id) => !hand.some((card) => card.id === id))) {
    return fail('CARD_NOT_IN_HAND');
  }

  const discarded = hand.filter((card) => chosen.has(card.id));
  const kept = hand.filter((card) => !chosen.has(card.id));
  const hands = round.hands.map((other, index) => (index === seat ? kept : other));
  return {
    ok: true,
    round: { ...round, hands, dabbStatus: 'discarded', discarded },
    events: [{ type: 'dabbDiscarded', seat }],
  };
}

/** Augen der gedrückten Karten; sie zählen bei der Abrechnung für die Spielmacher-Partei. */
export function discardedEyes(round: RoundState): number {
  return round.discarded.reduce((sum, card) => sum + cardEyes(card), 0);
}
