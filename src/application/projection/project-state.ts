import type { Card } from '../../domain/cards/card';
import type { Meld } from '../../domain/melds/meld';
import type { TrickPlay } from '../../domain/rules/trick';
import { assertSeat, partyOf, type Seat } from '../../domain/rules/parties';
import { activeSeat, type GameState, type RoundState } from '../../domain/state/game-state';
import { legalIntents } from '../../domain/state/legal-intents';
import type { CompletedTrickView, DabbView, PlayerView, SeatInfo } from './player-view';

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
    dabb: round ? projectDabb(round, seat) : null,
    declaration: round?.declaration
      ? { trump: round.declaration.trump, mode: round.declaration.mode }
      : null,
    // Gemeldete Karten sind öffentlich (FA-15) und gehen deshalb an alle Sitze.
    melds: round
      ? round.melds.map((entry) =>
          entry ? { melds: entry.melds.map(toMeld), points: entry.points } : null,
        )
      : seats.map(() => null),
    // Gelegte Karten sind öffentlich: der laufende Stich und der zuletzt abgeschlossene.
    trick: state.phase === 'trick' && round ? { plays: round.trick.map(toPlay) } : null,
    lastTrick: projectLastTrick(round),
    // Abrechnung und Spielende füllen die Schritte 17–18.
    roundResult: null,
    readySeats: [],
    activeSeat: activeSeat(state),
    scores: [...state.scores],
    abortReason: state.abortReason,
    winners: null,
    availableActions: legalIntents(state, seat),
  };
}

/**
 * Entscheidung vom 18.11.2026: Die Dabb-Karten sieht nur der Spielmacher, und erst nach der
 * Aufnahme. Danach sieht er, was er gedrückt hat. Alle anderen sehen nur Größe und Lage.
 */
function projectDabb(round: RoundState, seat: Seat): DabbView {
  const { dabb, dabbStatus, discarded, declarer } = round;
  const visible = seat === declarer;
  switch (dabbStatus) {
    case 'table':
      return { size: dabb.length, status: dabbStatus, cards: null };
    case 'taken':
      return { size: dabb.length, status: dabbStatus, cards: visible ? dabb.map(toCard) : null };
    case 'discarded':
      return {
        size: discarded.length,
        status: dabbStatus,
        cards: visible ? discarded.map(toCard) : null,
      };
  }
}

function projectLastTrick(round: RoundState | null): CompletedTrickView | null {
  const last = round?.tricks[round.tricks.length - 1];
  return last ? { plays: last.plays.map(toPlay), winner: last.winner } : null;
}

function toPlay({ seat, card }: TrickPlay): TrickPlay {
  return { seat, card: toCard(card) };
}

function toMeld({ id, kind, cards, points }: Meld): Meld {
  return { id, kind, cards: cards.map(toCard), points };
}

function toCard({ id, suit, rank, copy }: Card): Card {
  return { id, suit, rank, copy };
}
