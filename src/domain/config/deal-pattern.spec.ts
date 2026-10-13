import { describe, expect, it } from 'vitest';
import { dabbSize, dealPattern, handSize, type DealConfig } from './deal-pattern';

const cases: { config: DealConfig; pattern: number[]; hand: number; dabb: number }[] = [
  { config: { playerCount: 3, deckSize: 40 }, pattern: [4, 2, 4, 2, 4], hand: 12, dabb: 4 },
  { config: { playerCount: 4, deckSize: 40 }, pattern: [3, 2, 3, 2, 3], hand: 9, dabb: 4 },
  { config: { playerCount: 3, deckSize: 48 }, pattern: [5, 1, 5, 2, 5], hand: 15, dabb: 3 },
  { config: { playerCount: 4, deckSize: 48 }, pattern: [4, 2, 3, 2, 4], hand: 11, dabb: 4 },
];

describe.each(cases)('Verteilmuster $config.playerCount Spieler / $config.deckSize Karten', (c) => {
  it('folgt dem Muster aus der Spezifikation', () => {
    expect(dealPattern(c.config).map((step) => step.count)).toEqual(c.pattern);
  });

  it('wechselt zwischen Spieler- und Dabb-Paketen', () => {
    expect(dealPattern(c.config).map((step) => step.target)).toEqual([
      'players',
      'dabb',
      'players',
      'dabb',
      'players',
    ]);
  });

  it('leitet Hand- und Dabb-Größe ab', () => {
    expect(handSize(c.config)).toBe(c.hand);
    expect(dabbSize(c.config)).toBe(c.dabb);
  });

  it('verbraucht genau das ganze Blatt', () => {
    expect(handSize(c.config) * c.config.playerCount + dabbSize(c.config)).toBe(c.config.deckSize);
  });
});
