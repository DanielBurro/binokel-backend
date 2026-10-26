import type { Card } from '../cards/card';
import type { GameConfig } from '../config/game-config';
import { assertSeat, partyCount, type Seat } from '../rules/parties';

export const ROUND_PHASES = ['bidding', 'dabb', 'declare', 'meld', 'trick', 'score'] as const;
export type RoundPhase = (typeof ROUND_PHASES)[number];
/** 'created': Das Spiel ist angelegt, die erste Runde aber noch nicht ausgeteilt. */
export const PHASES = ['created', ...ROUND_PHASES, 'terminated'] as const;
export type Phase = (typeof PHASES)[number];

export const ABORT_REASONS = ['PLAYER_LEFT'] as const;
export type AbortReason = (typeof ABORT_REASONS)[number];

export interface BiddingState {
  /** Beginnt mit dem Eröffnungsgebot von Vorhand. */
  readonly highestBid: number;
  readonly highestBidder: Seat;
  readonly passed: readonly Seat[];
  /** Wer als Nächstes bieten oder passen muss; null, sobald das Reizen entschieden ist. */
  readonly activeSeat: Seat | null;
}

export interface RoundState {
  readonly dealer: Seat;
  readonly forehand: Seat;
  /** Nach Sitz indiziert. */
  readonly hands: readonly (readonly Card[])[];
  readonly dabb: readonly Card[];
  readonly bidding: BiddingState;
  /** Spielmacher nach dem Reizen; sein Reizwert ist `bidding.highestBid`. */
  readonly declarer: Seat | null;
}

export interface GameState {
  readonly config: GameConfig;
  /** Steigt mit jedem erfolgreich angewendeten Intent um eins. */
  readonly version: number;
  readonly phase: Phase;
  /** Geber der laufenden bzw. der nächsten Runde. */
  readonly dealer: Seat;
  /** Nach Partei indiziert. */
  readonly scores: readonly number[];
  /** null bis zur ersten Runde. */
  readonly round: RoundState | null;
  readonly abortReason: AbortReason | null;
}

export function createGame(config: GameConfig, firstDealer: Seat): GameState {
  assertSeat(firstDealer, config.playerCount);
  return {
    config,
    version: 0,
    phase: 'created',
    dealer: firstDealer,
    scores: Array.from({ length: partyCount(config.playerCount) }, () => 0),
    round: null,
    abortReason: null,
  };
}

/** Sitz, der als Nächstes handeln muss; die übrigen Phasen kommen mit den Schritten 13–18 hinzu. */
export function activeSeat(state: GameState): Seat | null {
  if (state.phase !== 'bidding' || state.round === null) return null;
  return state.round.bidding.activeSeat;
}

const PHASE_SUCCESSORS: Readonly<Partial<Record<Phase, RoundPhase>>> = {
  bidding: 'dabb',
  dabb: 'declare',
  declare: 'meld',
  meld: 'trick',
  trick: 'score',
};

/** Erweiterungspunkt: Abgehen und Sonderregeln wie Durch oder Tauschen weichen hier ab. */
export function nextPhase(state: GameState): RoundPhase {
  const next = PHASE_SUCCESSORS[state.phase];
  if (next === undefined) {
    throw new Error(`Phase ${state.phase} hat keine Folgephase`);
  }
  return next;
}
