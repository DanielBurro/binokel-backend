import type { Card, Suit } from '../cards/card';
import type { GameConfig } from '../config/game-config';
import { assertSeat, partyCount, type Seat } from '../rules/parties';

export const ROUND_PHASES = ['bidding', 'dabb', 'declare', 'meld', 'trick', 'score'] as const;
export type RoundPhase = (typeof ROUND_PHASES)[number];
/** 'created': Das Spiel ist angelegt, die erste Runde aber noch nicht ausgeteilt. */
export const PHASES = ['created', ...ROUND_PHASES, 'terminated'] as const;
export type Phase = (typeof PHASES)[number];

export const ABORT_REASONS = ['PLAYER_LEFT'] as const;
export type AbortReason = (typeof ABORT_REASONS)[number];

/** 'play': Der Spielmacher spielt die Runde aus; 'abgehen': Er gibt sie vor dem Stichspiel auf. */
export const DECLARE_MODES = ['play', 'abgehen'] as const;
export type DeclareMode = (typeof DECLARE_MODES)[number];

/** Ansage des Spielmachers: Trumpf und Spielart. */
export interface Declaration {
  readonly trump: Suit;
  readonly mode: DeclareMode;
}

/** 'made': Reizwert erreicht; 'failed': verfehlt; 'abgehen': Die Runde wurde nicht ausgespielt. */
export const ROUND_OUTCOMES = ['made', 'failed', 'abgehen'] as const;
export type RoundOutcome = (typeof ROUND_OUTCOMES)[number];

/**
 * 'table': liegt verdeckt in der Mitte; 'taken': beim Spielmacher auf der Hand;
 * 'discarded': Der Spielmacher hat gedrückt.
 */
export const DABB_STATUSES = ['table', 'taken', 'discarded'] as const;
export type DabbStatus = (typeof DABB_STATUSES)[number];

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
  /**
   * Die ausgeteilten Dabb-Karten. Sie bleiben nach der Aufnahme hier vermerkt, damit der
   * Spielmacher sieht, welche Karten aus dem Dabb kamen; liegen tun sie dann auf seiner Hand.
   */
  readonly dabb: readonly Card[];
  readonly dabbStatus: DabbStatus;
  /** Vom Spielmacher gedrückte Karten; leer bis zum Drücken. Ihre Augen zählen für ihn. */
  readonly discarded: readonly Card[];
  readonly bidding: BiddingState;
  /** Spielmacher nach dem Reizen; sein Reizwert ist `bidding.highestBid`. */
  readonly declarer: Seat | null;
  /** null bis zur Ansage. */
  readonly declaration: Declaration | null;
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

/** Sitz, der als Nächstes handeln muss; die übrigen Phasen kommen mit den Schritten 15–18 hinzu. */
export function activeSeat(state: GameState): Seat | null {
  const { phase, round } = state;
  if (round === null) return null;
  switch (phase) {
    case 'bidding':
      return round.bidding.activeSeat;
    case 'dabb':
    case 'declare':
      return round.declarer;
    default:
      return null;
  }
}

const PHASE_SUCCESSORS: Readonly<Partial<Record<Phase, RoundPhase>>> = {
  bidding: 'dabb',
  dabb: 'declare',
  declare: 'meld',
  meld: 'trick',
  trick: 'score',
};

/**
 * Erweiterungspunkt für Abweichungen von der klassischen Folge: Beim Abgehen geht es nach dem
 * Melden direkt in die Abrechnung, später weichen Sonderregeln wie Durch oder Tauschen hier ab.
 */
export function nextPhase(state: GameState): RoundPhase {
  if (state.phase === 'meld' && state.round?.declaration?.mode === 'abgehen') return 'score';
  const next = PHASE_SUCCESSORS[state.phase];
  if (next === undefined) {
    throw new Error(`Phase ${state.phase} hat keine Folgephase`);
  }
  return next;
}
