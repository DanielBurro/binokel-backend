import { describe, expect, it } from 'vitest';
import { makeCard } from '../cards/card';
import { declare } from './declare';
import type { RoundState } from './game-state';

/** Drei Sitze, Spielmacher 1, Dabb schon gedrückt. */
function round(): RoundState {
  return {
    dealer: 0,
    forehand: 1,
    hands: [[makeCard('eichel', 'unter', 1)], [makeCard('herz', 'ass', 1)], []],
    dabb: [makeCard('gruen', 'ober', 2)],
    dabbStatus: 'discarded',
    discarded: [makeCard('gruen', 'ober', 2)],
    bidding: { highestBid: 150, highestBidder: 1, passed: [2, 0], activeSeat: null },
    declarer: 1,
    declaration: null,
    melds: [null, null, null],
    trick: [],
    tricks: [],
    result: null,
    ready: [],
  };
}

describe('declare', () => {
  it.each([
    ['herz', 'play'],
    ['schellen', 'abgehen'],
  ] as const)('hält Trumpf %s und Spielart %s fest', (trump, mode) => {
    const before = round();
    const result = declare(before, 1, { trump, mode });

    expect(result).toEqual({
      ok: true,
      round: { ...before, declaration: { trump, mode } },
      events: [{ type: 'declared', seat: 1, trump, mode }],
    });
  });

  it('erlaubt eine Trumpffarbe, von der der Spielmacher keine Karte hält', () => {
    expect(declare(round(), 1, { trump: 'eichel', mode: 'play' }).ok).toBe(true);
  });

  it('lässt nur den Spielmacher ansagen', () => {
    expect(declare(round(), 0, { trump: 'herz', mode: 'play' })).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
  });
});
