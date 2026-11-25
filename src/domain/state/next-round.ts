import type { Seat } from '../rules/parties';
import type { GameState, RoundState } from './game-state';
import { fail, type GameEvent, type IntentFailure } from './intents';

export type ReadyResult =
  | { readonly ok: true; readonly round: RoundState; readonly events: readonly GameEvent[] }
  | IntentFailure;

/** Ein Sitz bestätigt nach der Abrechnung die nächste Runde, jeder genau einmal. */
export function markReady(round: RoundState, seat: Seat): ReadyResult {
  if (round.ready.includes(seat)) return fail('ALREADY_READY');
  return {
    ok: true,
    round: { ...round, ready: [...round.ready, seat] },
    events: [{ type: 'playerReady', seat }],
  };
}

/** Alle haben bestätigt; dann teilt der GameService mit `startRound` die nächste Runde aus. */
export function everyoneReady(state: GameState): boolean {
  return state.phase === 'score' && state.round?.ready.length === state.config.playerCount;
}
