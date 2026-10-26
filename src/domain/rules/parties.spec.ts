import { describe, expect, it } from 'vitest';
import { assertSeat, isSeat, nextSeat, partyCount, partyOf } from './parties';

describe('partyOf', () => {
  it('lässt bei drei Spielern jeden für sich spielen', () => {
    expect([0, 1, 2].map((seat) => partyOf(seat, 3))).toEqual([0, 1, 2]);
    expect(partyCount(3)).toBe(3);
  });

  it('bildet bei vier Spielern Parteien aus Sitz p und (p+2) mod 4', () => {
    for (const seat of [0, 1, 2, 3]) {
      expect(partyOf(seat, 4)).toBe(partyOf((seat + 2) % 4, 4));
    }
    expect(partyOf(0, 4)).not.toBe(partyOf(1, 4));
    expect(partyCount(4)).toBe(2);
  });

  it('weist ungültige Sitze ab', () => {
    expect(() => partyOf(3, 3)).toThrow(RangeError);
    expect(() => partyOf(-1, 4)).toThrow(RangeError);
    expect(() => assertSeat(1.5, 4)).toThrow(RangeError);
  });
});

describe('nextSeat', () => {
  it('geht reihum und springt vom letzten Sitz auf Sitz 0', () => {
    expect([0, 1, 2].map((seat) => nextSeat(seat, 3))).toEqual([1, 2, 0]);
    expect([0, 1, 2, 3].map((seat) => nextSeat(seat, 4))).toEqual([1, 2, 3, 0]);
  });
});

describe('isSeat', () => {
  it('erkennt gültige Sitze, ohne zu werfen', () => {
    expect(isSeat(0, 3)).toBe(true);
    expect(isSeat(3, 4)).toBe(true);
    expect(isSeat(3, 3)).toBe(false);
    expect(isSeat(0.5, 3)).toBe(false);
  });
});
