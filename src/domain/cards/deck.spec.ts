import { describe, expect, it } from 'vitest';
import type { DeckSize } from '../config/game-config';
import { SUITS, cardEyes } from './card';
import { buildDeck } from './deck';

describe.each<DeckSize>([40, 48])('buildDeck(%i)', (deckSize) => {
  const deck = buildDeck(deckSize);

  it('enthält genau deckSize Karten mit eindeutigen IDs', () => {
    expect(deck).toHaveLength(deckSize);
    expect(new Set(deck.map((card) => card.id)).size).toBe(deckSize);
  });

  it('enthält jede Farbe-Rang-Kombination genau zweimal', () => {
    const counts = new Map<string, number>();
    for (const card of deck) {
      const key = `${card.suit}-${card.rank}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.values()].every((count) => count === 2)).toBe(true);
    expect(counts.size).toBe(deckSize / 2);
  });

  it('verteilt alle Farben gleichmäßig', () => {
    for (const suit of SUITS) {
      expect(deck.filter((card) => card.suit === suit)).toHaveLength(deckSize / 4);
    }
  });

  it('summiert die Augen auf 240', () => {
    expect(deck.reduce((sum, card) => sum + cardEyes(card), 0)).toBe(240);
  });
});

describe('buildDeck Siebener', () => {
  it('enthält Siebener nur im 48er-Blatt', () => {
    expect(buildDeck(48).filter((card) => card.rank === 'sieben')).toHaveLength(8);
    expect(buildDeck(40).filter((card) => card.rank === 'sieben')).toHaveLength(0);
  });
});
