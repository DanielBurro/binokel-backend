import { describe, expect, it } from 'vitest';
import { buildDeck } from '../cards/deck';
import { dabbSize, handSize, type DealConfig } from '../config/deal-pattern';
import { deal, forehandOf } from './deal';

const configs: DealConfig[] = [
  { playerCount: 3, deckSize: 40 },
  { playerCount: 4, deckSize: 40 },
  { playerCount: 3, deckSize: 48 },
  { playerCount: 4, deckSize: 48 },
];

/** IDs der Karten im halboffenen Index-Bereich [from, to) des unvermischten Blatts. */
function slice(config: DealConfig, from: number, to: number): string[] {
  return buildDeck(config.deckSize)
    .slice(from, to)
    .map((card) => card.id);
}

const ids = (cards: readonly { id: string }[]): string[] => cards.map((card) => card.id);

describe('forehandOf', () => {
  it('ist der Sitz nach dem Geber', () => {
    expect(forehandOf(0, 3)).toBe(1);
    expect(forehandOf(2, 3)).toBe(0);
    expect(forehandOf(3, 4)).toBe(0);
  });
});

describe('deal', () => {
  it('verteilt 5-1-5-2-5 bei 3 Spielern / 48 Karten ab Vorhand', () => {
    const config = configs[2];
    const result = deal(buildDeck(48), config, 2);

    expect(ids(result.hands[0])).toEqual([
      ...slice(config, 0, 5),
      ...slice(config, 16, 21),
      ...slice(config, 33, 38),
    ]);
    expect(ids(result.hands[1])).toEqual([
      ...slice(config, 5, 10),
      ...slice(config, 21, 26),
      ...slice(config, 38, 43),
    ]);
    expect(ids(result.hands[2])).toEqual([
      ...slice(config, 10, 15),
      ...slice(config, 26, 31),
      ...slice(config, 43, 48),
    ]);
    expect(ids(result.dabb)).toEqual([...slice(config, 15, 16), ...slice(config, 31, 33)]);
  });

  it('beginnt bei Geber 0 und 3 Spielern mit Sitz 1', () => {
    const config = configs[0];
    const result = deal(buildDeck(40), config, 0);

    expect(ids(result.hands[1]).slice(0, 4)).toEqual(slice(config, 0, 4));
    expect(ids(result.hands[2]).slice(0, 4)).toEqual(slice(config, 4, 8));
    expect(ids(result.hands[0]).slice(0, 4)).toEqual(slice(config, 8, 12));
    expect(ids(result.dabb).slice(0, 2)).toEqual(slice(config, 12, 14));
  });

  it('verteilt 4-2-3-2-4 bei 4 Spielern / 48 Karten', () => {
    const config = configs[3];
    const result = deal(buildDeck(48), config, 3);

    // Vorhand = Sitz 0; Pakete: 4 je Spieler (16), Dabb 2, 3 je Spieler (12), Dabb 2, 4 je Spieler (16).
    expect(ids(result.hands[0])).toEqual([
      ...slice(config, 0, 4),
      ...slice(config, 18, 21),
      ...slice(config, 32, 36),
    ]);
    expect(ids(result.hands[3])).toEqual([
      ...slice(config, 12, 16),
      ...slice(config, 27, 30),
      ...slice(config, 44, 48),
    ]);
    expect(ids(result.dabb)).toEqual([...slice(config, 16, 18), ...slice(config, 30, 32)]);
  });

  describe.each(configs)('$playerCount Spieler / $deckSize Karten', (config) => {
    it.each([...Array(config.playerCount).keys()])(
      'erhält alle Karten genau einmal (Geber %i)',
      (dealer) => {
        const deck = buildDeck(config.deckSize);
        const result = deal(deck, config, dealer);

        expect(result.hands).toHaveLength(config.playerCount);
        for (const hand of result.hands) {
          expect(hand).toHaveLength(handSize(config));
        }
        expect(result.dabb).toHaveLength(dabbSize(config));

        const dealt = [...result.hands.flat(), ...result.dabb].map((card) => card.id);
        expect(new Set(dealt).size).toBe(config.deckSize);
        expect([...dealt].sort()).toEqual(deck.map((card) => card.id).sort());
      },
    );
  });

  it('verändert das übergebene Blatt nicht', () => {
    const deck = buildDeck(40);
    const copy = [...deck];
    deal(deck, configs[0], 1);
    expect(deck).toEqual(copy);
  });

  it('weist ein Blatt falscher Größe ab', () => {
    expect(() => deal(buildDeck(40), configs[2], 0)).toThrow(RangeError);
  });

  it('weist ungültige Geber ab', () => {
    expect(() => deal(buildDeck(40), configs[0], 3)).toThrow(RangeError);
  });
});
