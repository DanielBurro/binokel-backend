import type { Card } from '../../domain/cards/card';
import { assertSeat, partyOf, type Seat } from '../../domain/rules/parties';
import { BID_STEP, MAX_BID, minimumBid } from '../../domain/state/bidding';
import { activeSeat, type GameState } from '../../domain/state/game-state';
import type { AvailableActions, PlayerView, SeatInfo } from './player-view';

const NO_ACTIONS: AvailableActions = { intents: [], bidRange: null };

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
    activeSeat: activeSeat(state),
    scores: [...state.scores],
    abortReason: state.abortReason,
    availableActions: availableActions(state, seat),
  };
}

/** Wächst mit den Schritten 13–18 um die Intents der übrigen Phasen und die legalen Karten. */
function availableActions(state: GameState, seat: Seat): AvailableActions {
  const { phase, round } = state;
  if (phase !== 'bidding' || round === null || activeSeat(state) !== seat) return NO_ACTIONS;
  return {
    intents: ['bid', 'pass'],
    bidRange: { min: minimumBid(round.bidding), max: MAX_BID, step: BID_STEP },
  };
}

function toCard({ id, suit, rank, copy }: Card): Card {
  return { id, suit, rank, copy };
}
