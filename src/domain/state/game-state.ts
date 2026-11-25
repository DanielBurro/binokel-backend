import type { Card, Suit } from '../cards/card';
import type { GameConfig } from '../config/game-config';
import type { Meld } from '../melds/meld';
import { assertSeat, partyCount, type Seat } from '../rules/parties';
import type { TrickPlay } from '../rules/trick';
import { nextMelder } from './melding';
import { nextPlayer } from './trick-play';

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

/** Was ein Sitz gemeldet hat; öffentlich, gezählt wird es erst in der Abrechnung. */
export interface SeatMelds {
  readonly melds: readonly Meld[];
  readonly points: number;
}

export interface CompletedTrick {
  /** In Ausspielreihenfolge. */
  readonly plays: readonly TrickPlay[];
  readonly winner: Seat;
}

/** Wertung einer Partei in einer Runde (Studienarbeit, Phase 7). */
export interface PartyResult {
  /** Ungerundete Augen: gewonnene Karten, 10 für den letzten Stich, beim Spielmacher der Dabb. */
  readonly eyes: number;
  /** Anzahl der gewonnenen Stiche; der gedrückte Dabb zählt nicht als Stich. */
  readonly tricksWon: number;
  /** Augen, auf den nächsten Zehner gerundet. */
  readonly trickPoints: number;
  /** Summe der gemeldeten Punkte aller Sitze der Partei. */
  readonly meldPoints: number;
  /** false, wenn die Meldepunkte verfallen sind (kein Stich, oder Spielmacher verfehlt). */
  readonly meldsCounted: boolean;
  /** Veränderung des Punktestands; kann negativ sein. */
  readonly delta: number;
}

export interface RoundResult {
  readonly outcome: RoundOutcome;
  /** Nach Partei indiziert. */
  readonly parties: readonly PartyResult[];
}

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
  /** Nach Sitz indiziert; null, solange der Sitz nicht gemeldet hat oder nicht melden darf. */
  readonly melds: readonly (SeatMelds | null)[];
  /** Karten des laufenden Stichs in Ausspielreihenfolge; leer außerhalb des Stichspiels. */
  readonly trick: readonly TrickPlay[];
  /** Abgeschlossene Stiche in Spielreihenfolge. */
  readonly tricks: readonly CompletedTrick[];
  /** Rundenwertung; null bis zur Abrechnung. */
  readonly result: RoundResult | null;
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

/** Sitz, der als Nächstes handeln muss; in der Abrechnung und danach niemand. */
export function activeSeat(state: GameState): Seat | null {
  const { phase, round } = state;
  if (round === null) return null;
  switch (phase) {
    case 'bidding':
      return round.bidding.activeSeat;
    case 'dabb':
    case 'declare':
      return round.declarer;
    case 'meld':
      return nextMelder(round, state.config.playerCount);
    case 'trick':
      return nextPlayer(round, state.config.playerCount);
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
