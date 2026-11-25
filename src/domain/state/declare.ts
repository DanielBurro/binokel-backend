import type { Seat } from '../rules/parties';
import type { Declaration, RoundState } from './game-state';
import { fail, type GameEvent, type IntentFailure } from './intents';

export type DeclareResult =
  | { readonly ok: true; readonly round: RoundState; readonly events: readonly GameEvent[] }
  | IntentFailure;

/**
 * Der Spielmacher sagt Trumpf und Spielart an (FA-09). Jede Farbe ist erlaubt, auch eine, von
 * der er keine Karte hält. Die Phase prüft der Aufrufer.
 */
export function declare(round: RoundState, seat: Seat, declaration: Declaration): DeclareResult {
  if (seat !== round.declarer) return fail('NOT_YOUR_TURN');
  const { trump, mode } = declaration;
  return {
    ok: true,
    round: { ...round, declaration: { trump, mode } },
    events: [{ type: 'declared', seat, trump, mode }],
  };
}
