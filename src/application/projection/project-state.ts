import type { Card } from '../../domain/cards/card';
import { assertSeat, partyOf, type Seat } from '../../domain/rules/parties';
import { activeSeat, type GameState } from '../../domain/state/game-state';
import { legalIntents } from '../../domain/state/legal-intents';
import type { PlayerView, SeatInfo } from './player-view';

/** Baut die Sicht eines Sitzes Feld für Feld auf, damit nichts ungewollt durchrutscht. */
export function projectStateFor(
  state: GameState,
  seat: Seat,
  seats: readonly SeatInfo[],
): PlayerView {
  const { config, round } = state;
  assertSeat(seat, config.playerCount);
  if (seats.length !== config.playerCount) {
    throw new RangeError(`${seats.length} Sitzinfos statt ${config.playerCount}`);
  }

  return {
    version: state.version,
    phase: state.phase,
    config: { ...config, specialRules: { ...config.specialRules } },
    ownSeat: seat,
    seats: seats.map((info, index) => ({
      seat: index,
      party: partyOf(index, config.playerCount),
      displayName: info.displayName,
      connected: info.connected,
      handSize: round?.hands[index].length ?? 0,
    })),
    hand: (round?.hands[seat] ?? []).map(toCard),
    dealer: state.dealer,
    forehand: round?.forehand ?? null,
    bidding: round
      ? {
          highestBid: round.bidding.highestBid,
          highestBidder: round.bidding.highestBidder,
          passed: [...round.bidding.passed],
        }
      : null,
    declarer: round?.declarer ?? null,
    // Bis Schritt 13 liegt der Dabb verdeckt; wer seine Karten sehen darf, entscheidet sich dort.
    dabb: round ? { size: round.dabb.length, status: 'table', cards: null } : null,
    // Ansage, Meldungen, Stiche, Abrechnung und Spielende füllen die Schritte 14–18.
    declaration: null,
    melds: seats.map(() => null),
    trick: null,
    lastTrick: null,
    roundResult: null,
    readySeats: [],
    activeSeat: activeSeat(state),
    scores: [...state.scores],
    abortReason: state.abortReason,
    winners: null,
    availableActions: legalIntents(state, seat),
  };
}

function toCard({ id, suit, rank, copy }: Card): Card {
  return { id, suit, rank, copy };
}
