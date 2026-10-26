import type { PlayerCount } from '../config/game-config';
import { nextSeat, type Seat } from '../rules/parties';
import type { BiddingState } from './game-state';
import { fail, type GameEvent, type IntentFailure } from './intents';

export const OPENING_BID = 150;
export const BID_STEP = 10;
/** Ein Gebot in dieser Höhe beendet das Reizen sofort. */
export const MAX_BID = 1000;

export type BiddingResult =
  | { readonly ok: true; readonly bidding: BiddingState; readonly events: readonly GameEvent[] }
  | IntentFailure;

/** Vorhand hält das Eröffnungsgebot, der Sitz danach ist zuerst am Zug. */
export function openBidding(forehand: Seat, playerCount: PlayerCount): BiddingState {
  return {
    highestBid: OPENING_BID,
    highestBidder: forehand,
    passed: [],
    activeSeat: nextSeat(forehand, playerCount),
  };
}

export function bid(
  bidding: BiddingState,
  seat: Seat,
  amount: number,
  playerCount: PlayerCount,
): BiddingResult {
  if (seat !== bidding.activeSeat) return fail('NOT_YOUR_TURN');
  if (amount > MAX_BID) return fail('BID_ABOVE_LIMIT');
  if (amount < bidding.highestBid + BID_STEP) return fail('BID_TOO_LOW');
  if (amount % BID_STEP !== 0) return fail('BID_NOT_IN_STEPS');

  return advance({ ...bidding, highestBid: amount, highestBidder: seat }, seat, playerCount, [
    { type: 'bidPlaced', seat, amount },
  ]);
}

export function pass(bidding: BiddingState, seat: Seat, playerCount: PlayerCount): BiddingResult {
  if (seat !== bidding.activeSeat) return fail('NOT_YOUR_TURN');

  return advance({ ...bidding, passed: [...bidding.passed, seat] }, seat, playerCount, [
    { type: 'passed', seat },
  ]);
}

function advance(
  bidding: BiddingState,
  from: Seat,
  playerCount: PlayerCount,
  events: readonly GameEvent[],
): BiddingResult {
  const activeSeat = bidding.highestBid === MAX_BID ? null : nextBidder(bidding, from, playerCount);
  const next = { ...bidding, activeSeat };
  if (activeSeat !== null) {
    return { ok: true, bidding: next, events };
  }
  return {
    ok: true,
    bidding: next,
    events: [
      ...events,
      { type: 'biddingWon', declarer: bidding.highestBidder, bid: bidding.highestBid },
    ],
  };
}

/** Überspringt Gepasste und den Höchstbietenden; null, wenn alle anderen gepasst haben. */
function nextBidder(bidding: BiddingState, from: Seat, playerCount: PlayerCount): Seat | null {
  let seat = from;
  for (let step = 0; step < playerCount; step++) {
    seat = nextSeat(seat, playerCount);
    if (seat !== bidding.highestBidder && !bidding.passed.includes(seat)) {
      return seat;
    }
  }
  return null;
}
