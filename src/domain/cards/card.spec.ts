import { describe, expect, it } from 'vitest';
import { RANKS, RANK_EYES, RANK_STRENGTH, cardEyes, makeCard } from './card';

describe('card', () => {
  it('vergibt stabile, eindeutige IDs je Exemplar', () => {
    expect(makeCard('herz', 'ass', 1).id).toBe('herz-ass-1');
    expect(makeCard('herz', 'ass', 1).id).not.toBe(makeCard('herz', 'ass', 2).id);
  });

  it('ordnet RANKS absteigend nach Stichstärke', () => {
    const strengths = RANKS.map((rank) => RANK_STRENGTH[rank]);
    expect(strengths).toEqual([...strengths].sort((a, b) => b - a));
    expect(new Set(strengths).size).toBe(RANKS.length);
  });

  it('liefert die Augenwerte laut Spezifikation', () => {
    expect(RANK_EYES).toEqual({ ass: 11, zehn: 10, koenig: 4, ober: 3, unter: 2, sieben: 0 });
    expect(cardEyes(makeCard('eichel', 'zehn', 2))).toBe(10);
  });
});
