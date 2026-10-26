import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PlayerCount } from '../config/game-config';
import {
  BID_STEP,
  MAX_BID,
  OPENING_BID,
  bid,
  minimumBid,
  openBidding,
  pass,
  type BiddingResult,
} from './bidding';
import type { BiddingState } from './game-state';

function ok(result: BiddingResult): BiddingState {
  if (!result.ok) throw new Error(`Unerwarteter Fehler ${result.code}`);
  return result.bidding;
}

describe('openBidding', () => {
  it('gibt Vorhand das Eröffnungsgebot und lässt den Sitz danach beginnen', () => {
    expect(openBidding(1, 3)).toEqual({
      highestBid: OPENING_BID,
      highestBidder: 1,
      passed: [],
      activeSeat: 2,
    });
    expect(openBidding(3, 4).activeSeat).toBe(0);
  });
});

describe('minimumBid', () => {
  it('liegt einen Schritt über dem Höchstgebot', () => {
    expect(minimumBid(openBidding(1, 3))).toBe(OPENING_BID + BID_STEP);
    expect(minimumBid({ ...openBidding(1, 3), highestBid: MAX_BID - BID_STEP })).toBe(MAX_BID);
  });
});

describe('bid', () => {
  const opened = openBidding(1, 3);

  it('übernimmt das Höchstgebot und reicht an den nächsten Sitz weiter', () => {
    const result = bid(opened, 2, 160, 3);

    expect(result).toEqual({
      ok: true,
      bidding: { highestBid: 160, highestBidder: 2, passed: [], activeSeat: 0 },
      events: [{ type: 'bidPlaced', seat: 2, amount: 160 }],
    });
  });

  it('überspringt den Höchstbietenden', () => {
    // 4 Spieler, Vorhand 0: Sitz 1 bietet, Sitz 2 und 3 passen, dann ist Sitz 0 dran, nicht 1.
    let state = ok(bid(openBidding(0, 4), 1, 160, 4));
    state = ok(pass(state, 2, 4));
    state = ok(pass(state, 3, 4));
    expect(state.activeSeat).toBe(0);
  });

  it.each([
    [175, 'BID_NOT_IN_STEPS'],
    [150, 'BID_TOO_LOW'],
    [140, 'BID_TOO_LOW'],
    [MAX_BID + BID_STEP, 'BID_ABOVE_LIMIT'],
    [Number.NaN, 'BID_NOT_IN_STEPS'],
  ])('weist das Gebot %d mit %s ab', (amount, code) => {
    expect(bid(opened, 2, amount, 3)).toEqual({ ok: false, code });
  });

  it('weist Gebote außerhalb der Reihe ab', () => {
    expect(bid(opened, 0, 160, 3)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(bid(opened, 1, 160, 3)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
  });

  it('beendet das Reizen sofort bei einem Gebot in Höhe der Obergrenze', () => {
    const result = bid(opened, 2, MAX_BID, 3);

    expect(result).toEqual({
      ok: true,
      bidding: { highestBid: MAX_BID, highestBidder: 2, passed: [], activeSeat: null },
      events: [
        { type: 'bidPlaced', seat: 2, amount: MAX_BID },
        { type: 'biddingWon', declarer: 2, bid: MAX_BID },
      ],
    });
  });
});

describe('pass', () => {
  it('macht Vorhand zum Spielmacher mit 150, wenn alle anderen passen', () => {
    const state = ok(pass(openBidding(1, 3), 2, 3));
    const result = pass(state, 0, 3);

    expect(result).toEqual({
      ok: true,
      bidding: { highestBid: OPENING_BID, highestBidder: 1, passed: [2, 0], activeSeat: null },
      events: [
        { type: 'passed', seat: 0 },
        { type: 'biddingWon', declarer: 1, bid: OPENING_BID },
      ],
    });
  });

  it('lässt Gepasste nicht mehr an die Reihe kommen', () => {
    // 3 Spieler, Vorhand 1: Sitz 2 passt, Sitz 0 bietet, Vorhand ist dran und bietet, wieder Sitz 0.
    let state = ok(pass(openBidding(1, 3), 2, 3));
    state = ok(bid(state, 0, 160, 3));
    expect(state.activeSeat).toBe(1);
    state = ok(bid(state, 1, 170, 3));
    expect(state.activeSeat).toBe(0);
  });

  it('weist Passen außerhalb der Reihe ab', () => {
    expect(pass(openBidding(1, 3), 1, 3)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
  });

  it('weist jede Aktion nach Ende des Reizens ab', () => {
    const decided = ok(bid(openBidding(1, 3), 2, MAX_BID, 3));
    expect(pass(decided, 2, 3)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
  });
});

describe('Reizen als Ganzes', () => {
  // Jeder Zug: passen (null) oder um k Stufen erhöhen.
  const moves = fc.array(fc.option(fc.integer({ min: 1, max: 20 }), { nil: null }), {
    maxLength: 200,
  });

  it('endet mit genau n−1 Passen oder der Obergrenze, und der Höchstbietende gewinnt', () => {
    fc.assert(
      fc.property(fc.constantFrom<PlayerCount>(3, 4), fc.nat(3), moves, (n, rawForehand, list) => {
        const forehand = rawForehand % n;
        let state = openBidding(forehand, n);
        let wins = 0;

        for (const steps of [...list, ...Array<null>(n).fill(null)]) {
          if (state.activeSeat === null) break;
          const amount = Math.min(state.highestBid + (steps ?? 0) * BID_STEP, MAX_BID);
          const before = state.highestBid;
          const result =
            steps === null
              ? pass(state, state.activeSeat, n)
              : bid(state, state.activeSeat, amount, n);
          state = ok(result);
          wins += result.ok
            ? result.events.filter((event) => event.type === 'biddingWon').length
            : 0;
          expect(state.highestBid).toBeGreaterThanOrEqual(before);
        }

        expect(state.activeSeat).toBeNull();
        expect(wins).toBe(1);
        expect(state.passed).not.toContain(state.highestBidder);
        if (state.highestBid < MAX_BID) {
          expect(state.passed).toHaveLength(n - 1);
        }
      }),
    );
  });
});
