import type { Card } from '../cards/card';
import type { Seat } from '../rules/parties';
import type { AbortReason, GameState } from './game-state';

export const SYSTEM = 'system';
export type Actor = Seat | typeof SYSTEM;

export type PlayerIntent =
  { readonly type: 'bid'; readonly amount: number } | { readonly type: 'pass' };

/** Erzeugt nur der GameService; so kommt der Zufall des Mischens von außen in die reine Engine. */
export type SystemIntent =
  | { readonly type: 'startRound'; readonly shuffledDeck: readonly Card[] }
  | { readonly type: 'abortGame'; readonly reason: AbortReason };

export type Intent = PlayerIntent | SystemIntent;

export type GameEvent =
  | { readonly type: 'roundStarted'; readonly dealer: Seat; readonly forehand: Seat }
  | { readonly type: 'bidPlaced'; readonly seat: Seat; readonly amount: number }
  | { readonly type: 'passed'; readonly seat: Seat }
  | { readonly type: 'biddingWon'; readonly declarer: Seat; readonly bid: number }
  | { readonly type: 'gameAborted'; readonly reason: AbortReason };

export type IntentErrorCode =
  | 'INVALID_ACTOR'
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'BID_TOO_LOW'
  | 'BID_NOT_IN_STEPS'
  | 'BID_ABOVE_LIMIT'
  | 'INVALID_DECK';

export type IntentFailure = { readonly ok: false; readonly code: IntentErrorCode };

export type IntentResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly GameEvent[] }
  | IntentFailure;

export function fail(code: IntentErrorCode): IntentFailure {
  return { ok: false, code };
}
