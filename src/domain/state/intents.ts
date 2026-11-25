import type { Card, CardId, Suit } from '../cards/card';
import type { Meld, MeldId } from '../melds/meld';
import type { PartyId, Seat } from '../rules/parties';
import type { AbortReason, DeclareMode, GameState, RoundOutcome } from './game-state';

export const SYSTEM = 'system';
export type Actor = Seat | typeof SYSTEM;

/**
 * Alle Spielerzüge einer Runde. Die Engine setzt bisher Reizen, Dabb, Ansage und Melden um,
 * die übrigen folgen mit den Schritten 16–18 und werden bis dahin abgelehnt.
 */
export type PlayerIntent =
  | { readonly type: 'bid'; readonly amount: number }
  | { readonly type: 'pass' }
  | { readonly type: 'takeDabb' }
  | { readonly type: 'discardToDabb'; readonly cardIds: readonly CardId[] }
  | { readonly type: 'declare'; readonly trump: Suit; readonly mode: DeclareMode }
  /** Auswahl aus den Meldungen, die der Server dem Sitz anbietet. */
  | { readonly type: 'submitMelds'; readonly meldIds: readonly MeldId[] }
  | { readonly type: 'playCard'; readonly cardId: CardId }
  | { readonly type: 'readyForNextRound' };

/**
 * Erlaubter Zug eines Sitzes samt Spielraum, siehe `legalIntents`. Enthält nur, was der Sitz
 * selbst wissen darf, und geht deshalb unverändert als `availableActions` an seinen Client.
 */
export type LegalIntent =
  | { readonly type: 'bid'; readonly min: number; readonly max: number; readonly step: number }
  | { readonly type: 'pass' }
  | { readonly type: 'takeDabb' }
  /** `count` Karten der eigenen Hand sind zu drücken. */
  | { readonly type: 'discardToDabb'; readonly count: number }
  | { readonly type: 'declare'; readonly modes: readonly DeclareMode[] }
  /** Vorschlag des Servers; `submitMelds` darf daraus nur weglassen. */
  | { readonly type: 'submitMelds'; readonly melds: readonly Meld[] }
  /** Karten der eigenen Hand, die Farb-, Stich- und Trumpfzwang erlauben. */
  | { readonly type: 'playCard'; readonly cardIds: readonly CardId[] }
  | { readonly type: 'readyForNextRound' };

/** Erzeugt nur der GameService; so kommt der Zufall des Mischens von außen in die reine Engine. */
export type SystemIntent =
  | { readonly type: 'startRound'; readonly shuffledDeck: readonly Card[] }
  | { readonly type: 'abortGame'; readonly reason: AbortReason };

export type Intent = PlayerIntent | SystemIntent;

/** Öffentliche Ereignisse für alle Sitze; sie enthalten nie verdeckte Karten. */
export type GameEvent =
  | { readonly type: 'roundStarted'; readonly dealer: Seat; readonly forehand: Seat }
  | { readonly type: 'bidPlaced'; readonly seat: Seat; readonly amount: number }
  | { readonly type: 'passed'; readonly seat: Seat }
  | { readonly type: 'biddingWon'; readonly declarer: Seat; readonly bid: number }
  | { readonly type: 'dabbTaken'; readonly seat: Seat }
  | { readonly type: 'dabbDiscarded'; readonly seat: Seat }
  | {
      readonly type: 'declared';
      readonly seat: Seat;
      readonly trump: Suit;
      readonly mode: DeclareMode;
    }
  | {
      readonly type: 'meldsSubmitted';
      readonly seat: Seat;
      readonly melds: readonly Meld[];
      readonly points: number;
    }
  | { readonly type: 'cardPlayed'; readonly seat: Seat; readonly card: Card }
  | { readonly type: 'trickWon'; readonly winner: Seat }
  | { readonly type: 'roundScored'; readonly outcome: RoundOutcome }
  | { readonly type: 'playerReady'; readonly seat: Seat }
  | { readonly type: 'gameFinished'; readonly winners: readonly PartyId[] }
  | { readonly type: 'gameAborted'; readonly reason: AbortReason };

export const INTENT_ERROR_CODES = [
  'INVALID_ACTOR',
  'WRONG_PHASE',
  'NOT_YOUR_TURN',
  'BID_TOO_LOW',
  'BID_NOT_IN_STEPS',
  'BID_ABOVE_LIMIT',
  'INVALID_DECK',
  'DABB_ALREADY_TAKEN',
  'DABB_NOT_TAKEN',
  'WRONG_DISCARD_COUNT',
  'DUPLICATE_CARDS',
  'CARD_NOT_IN_HAND',
  'DUPLICATE_MELDS',
  'MELD_NOT_OFFERED',
] as const;
export type IntentErrorCode = (typeof INTENT_ERROR_CODES)[number];

export type IntentFailure = { readonly ok: false; readonly code: IntentErrorCode };

export type IntentResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly GameEvent[] }
  | IntentFailure;

export function fail(code: IntentErrorCode): IntentFailure {
  return { ok: false, code };
}
