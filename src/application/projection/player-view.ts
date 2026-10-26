import type { Card } from '../../domain/cards/card';
import type { GameConfig } from '../../domain/config/game-config';
import type { PartyId, Seat } from '../../domain/rules/parties';
import type { AbortReason, Phase } from '../../domain/state/game-state';
import type { PlayerIntent } from '../../domain/state/intents';

/** Sitzungsdaten eines Sitzes; kommen vom Raum, damit der GameState frei davon bleibt. */
export interface SeatInfo {
  readonly displayName: string;
  readonly connected: boolean;
}

export interface SeatView extends SeatInfo {
  readonly seat: Seat;
  readonly party: PartyId;
  readonly handSize: number;
}

export interface BiddingView {
  readonly highestBid: number;
  readonly highestBidder: Seat;
  readonly passed: readonly Seat[];
}

export type PlayerIntentType = PlayerIntent['type'];

export interface BidRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface AvailableActions {
  readonly intents: readonly PlayerIntentType[];
  /** Nur gesetzt, wenn `bid` erlaubt ist. */
  readonly bidRange: BidRange | null;
}

/**
 * Personalisierte Sicht eines Sitzes und Vertrag mit dem Frontend (FA-05).
 * Whitelist: Dabb und fremde Hände sind nie enthalten.
 */
export interface PlayerView {
  readonly version: number;
  readonly phase: Phase;
  readonly config: GameConfig;
  readonly ownSeat: Seat;
  readonly seats: readonly SeatView[];
  readonly hand: readonly Card[];
  readonly dealer: Seat;
  /** null bis zur ersten Runde. */
  readonly forehand: Seat | null;
  readonly bidding: BiddingView | null;
  readonly declarer: Seat | null;
  readonly activeSeat: Seat | null;
  /** Nach Partei indiziert. */
  readonly scores: readonly number[];
  readonly abortReason: AbortReason | null;
  readonly availableActions: AvailableActions;
}
