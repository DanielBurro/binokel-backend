import type { Card, Suit } from '../../domain/cards/card';
import type { GameConfig } from '../../domain/config/game-config';
import type { Meld } from '../../domain/melds/meld';
import type { PartyId, Seat } from '../../domain/rules/parties';
import type {
  AbortReason,
  DabbStatus,
  DeclareMode,
  Phase,
  RoundOutcome,
} from '../../domain/state/game-state';
import type { LegalIntent } from '../../domain/state/intents';

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

export interface DabbView {
  /** Anzahl der Karten im Dabb bzw. der gedrückten Karten. */
  readonly size: number;
  readonly status: DabbStatus;
  /**
   * Nur für den Spielmacher und erst nach der Aufnahme: bei 'taken' die aufgenommenen, bei
   * 'discarded' die gedrückten Karten. Für alle anderen Sitze immer null.
   */
  readonly cards: readonly Card[] | null;
}

export interface DeclarationView {
  readonly trump: Suit;
  readonly mode: DeclareMode;
}

/** Gemeldete Karten und Punkte eines Sitzes sind öffentlich. */
export interface SeatMeldsView {
  readonly melds: readonly Meld[];
  readonly points: number;
}

export interface TrickPlayView {
  readonly seat: Seat;
  readonly card: Card;
}

/** Laufender Stich in Ausspielreihenfolge. */
export interface TrickView {
  readonly plays: readonly TrickPlayView[];
}

export interface CompletedTrickView extends TrickView {
  readonly winner: Seat;
}

export interface PartyResultView {
  /** Gerundete Stichpunkte, inklusive letztem Stich und gedrückten Augen. */
  readonly trickPoints: number;
  readonly meldPoints: number;
  /** false, wenn die Meldepunkte verfallen sind. */
  readonly meldsCounted: boolean;
  /** Veränderung des Punktestands durch diese Runde; kann negativ sein. */
  readonly delta: number;
}

export interface RoundResultView {
  readonly outcome: RoundOutcome;
  /** Nach Partei indiziert. */
  readonly parties: readonly PartyResultView[];
}

/**
 * Personalisierte Sicht eines Sitzes und Vertrag mit dem Frontend (FA-05), ausgelegt auf die
 * ganze Runde. Whitelist: Fremde Hände sind nie enthalten, die Dabb-Karten nur für den
 * Spielmacher nach der Aufnahme. Die Felder ab `melds` füllen die Schritte 15–18.
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
  /** null bis zur ersten Runde. */
  readonly dabb: DabbView | null;
  /** Trumpf und Spielart; null bis zur Ansage. */
  readonly declaration: DeclarationView | null;
  /** Nach Sitz indiziert; null, solange der Sitz nicht gemeldet hat. */
  readonly melds: readonly (SeatMeldsView | null)[];
  /** null außerhalb des Stichspiels. */
  readonly trick: TrickView | null;
  readonly lastTrick: CompletedTrickView | null;
  /** Aufschlüsselung der Runde; null bis zur Abrechnung. */
  readonly roundResult: RoundResultView | null;
  /** Sitze, die nach der Abrechnung die nächste Runde bestätigt haben. */
  readonly readySeats: readonly Seat[];
  readonly activeSeat: Seat | null;
  /** Nach Partei indiziert. */
  readonly scores: readonly number[];
  readonly abortReason: AbortReason | null;
  /** Siegerparteien nach regulärem Spielende; bei Punktgleichheit mehrere. */
  readonly winners: readonly PartyId[] | null;
  /** Erlaubte Züge dieses Sitzes samt Spielraum; leer, wenn er nicht am Zug ist. */
  readonly availableActions: readonly LegalIntent[];
}
