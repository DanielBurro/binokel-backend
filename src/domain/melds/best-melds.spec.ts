import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeCard, SUITS, type Card, type CardCopy, type Rank, type Suit } from '../cards/card';
import { buildDeck } from '../cards/deck';
import type { DeckSize } from '../config/game-config';
import { bestMelds } from './best-melds';
import { MELD_GROUP, meldPoints, type Meld } from './meld';

const both = (suit: Suit, rank: Rank): Card[] => [makeCard(suit, rank, 1), makeCard(suit, rank, 2)];
const one = (suit: Suit, rank: Rank, copy: CardCopy = 1): Card => makeCard(suit, rank, copy);
const family = (suit: Suit, copy: CardCopy = 1): Card[] =>
  (['ass', 'zehn', 'koenig', 'ober', 'unter'] as const).map((rank) => one(suit, rank, copy));
const ofRank = (rank: Rank, copy: CardCopy = 1): Card[] =>
  SUITS.map((suit) => one(suit, rank, copy));

const summary = (melds: readonly Meld[]) => melds.map(({ id, points }) => [id, points]);

describe('bestMelds', () => {
  describe('Meldekatalog (Fehlfarbe und Trumpf)', () => {
    it.each<[string, Card[], Suit, [string, number][]]>([
      [
        'Paar in Fehlfarbe',
        [one('herz', 'koenig'), one('herz', 'ober')],
        'eichel',
        [['paar-herz-1', 20]],
      ],
      [
        'Paar in Trumpf',
        [one('herz', 'koenig'), one('herz', 'ober')],
        'herz',
        [['paar-herz-1', 40]],
      ],
      ['Familie in Fehlfarbe', family('gruen'), 'herz', [['familie-gruen', 100]]],
      ['Familie in Trumpf', family('gruen'), 'gruen', [['familie-gruen', 150]]],
      [
        'Doppelte Familie',
        [...family('eichel', 1), ...family('eichel', 2)],
        'eichel',
        [['doppelteFamilie-eichel', 1000]],
      ],
      ['Vier Unter', ofRank('unter'), 'herz', [['vierGleiche-unter', 40]]],
      ['Vier Ober', ofRank('ober'), 'herz', [['vierGleiche-ober', 60]]],
      ['Vier Könige', ofRank('koenig'), 'herz', [['vierGleiche-koenig', 80]]],
      ['Vier Asse', ofRank('ass'), 'herz', [['vierGleiche-ass', 100]]],
      [
        'Acht Gleiche',
        [...ofRank('ass', 1), ...ofRank('ass', 2)],
        'herz',
        [['achtGleiche-ass', 1000]],
      ],
      ['Binokel', [one('schellen', 'unter'), one('gruen', 'ober')], 'herz', [['binokel', 40]]],
      [
        'Doppel-Binokel',
        [...both('schellen', 'unter'), ...both('gruen', 'ober')],
        'herz',
        [['doppelBinokel', 300]],
      ],
    ])('%s', (_, hand, trump, expected) => {
      expect(summary(bestMelds(hand, trump, 40))).toEqual(expected);
    });

    it('wertet weder Zehnen noch Siebenen als Vier oder Acht Gleiche', () => {
      const hand = [...ofRank('zehn', 1), ...ofRank('zehn', 2), ...ofRank('sieben', 1)];
      expect(bestMelds(hand, 'herz', 48).filter((meld) => meld.kind !== 'diss')).toEqual([]);
    });

    it('zählt den Diß je Trumpf-Sieben, aber nur bei 48 Karten', () => {
      const hand = [...both('herz', 'sieben'), one('eichel', 'sieben')];

      expect(summary(bestMelds(hand, 'herz', 48))).toEqual([
        ['diss-1', 10],
        ['diss-2', 10],
      ]);
      expect(bestMelds(hand, 'herz', 40)).toEqual([]);
    });

    it('legt mit der Meldung genau die beteiligten Karten offen', () => {
      const hand = [one('herz', 'koenig', 2), one('herz', 'ober', 1), one('herz', 'zehn', 1)];

      expect(bestMelds(hand, 'eichel', 40)).toEqual([
        { id: 'paar-herz-1', kind: 'paar', cards: [hand[0], hand[1]], points: 20 },
      ]);
    });
  });

  describe('Gruppenregel', () => {
    it('zählt das Paar einer Familie nicht extra', () => {
      expect(summary(bestMelds(family('herz'), 'eichel', 40))).toEqual([['familie-herz', 100]]);
    });

    it('bildet aus einem zweiten König und Ober neben der Familie ein Paar', () => {
      const hand = [...family('herz'), one('herz', 'koenig', 2), one('herz', 'ober', 2)];

      expect(summary(bestMelds(hand, 'herz', 40))).toEqual([
        ['familie-herz', 150],
        ['paar-herz-1', 40],
      ]);
    });

    it('bildet ohne Familie bis zu zwei Paare je Farbe', () => {
      const hand = [...both('schellen', 'koenig'), ...both('schellen', 'ober')];

      expect(summary(bestMelds(hand, 'herz', 40))).toEqual([
        ['paar-schellen-1', 20],
        ['paar-schellen-2', 20],
      ]);
    });

    it('zieht die Doppelte Familie zwei Familien vor', () => {
      const melds = bestMelds([...family('herz', 1), ...family('herz', 2)], 'herz', 40);
      expect(summary(melds)).toEqual([['doppelteFamilie-herz', 1000]]);
    });

    it('zieht Acht Gleiche zweimal Vier Gleichen vor', () => {
      const melds = bestMelds([...ofRank('unter', 1), ...ofRank('unter', 2)], 'herz', 40);
      expect(summary(melds.filter((meld) => meld.kind !== 'binokel'))).toEqual([
        ['achtGleiche-unter', 1000],
      ]);
    });

    it('nutzt eine Karte in Meldungen verschiedener Gruppen', () => {
      // Grün-Ober steckt in Vier Ober (Satz), im Paar (Sequenz) und im Binokel (Spezial).
      const hand = [...ofRank('ober'), one('gruen', 'koenig'), one('schellen', 'unter')];

      expect(summary(bestMelds(hand, 'herz', 40))).toEqual([
        ['vierGleiche-ober', 60],
        ['paar-gruen-1', 20],
        ['binokel', 40],
      ]);
    });

    it('gibt für eine Hand ohne Kombination nichts zurück', () => {
      expect(bestMelds([one('herz', 'ass'), one('eichel', 'zehn')], 'herz', 40)).toEqual([]);
    });
  });

  describe('Eigenschaften', () => {
    // Bis zu 30 Karten, damit Familien, Acht Gleiche und Doppel-Binokel oft genug vorkommen.
    const hands = fc
      .tuple(fc.constantFrom<DeckSize>(40, 48), fc.constantFrom(...SUITS))
      .chain(([deckSize, trump]) =>
        fc
          .subarray(buildDeck(deckSize), { maxLength: 30 })
          .map((hand) => ({ deckSize, trump, hand })),
      );

    it('meldet nur eigene Karten, eindeutig benannt und je Gruppe kartendisjunkt', () => {
      fc.assert(
        fc.property(hands, ({ deckSize, trump, hand }) => {
          const melds = bestMelds(hand, trump, deckSize);
          const own = new Set(hand.map((card) => card.id));

          expect(new Set(melds.map((meld) => meld.id)).size).toBe(melds.length);
          for (const meld of melds) {
            for (const card of meld.cards) expect(own.has(card.id)).toBe(true);
          }
          for (const group of ['satz', 'sequenz', 'spezial'] as const) {
            const ids = melds
              .filter((meld) => MELD_GROUP[meld.kind] === group)
              .flatMap((meld) => meld.cards.map((card) => card.id));
            expect(new Set(ids).size).toBe(ids.length);
          }
        }),
      );
    });

    it('erreicht das Maximum einer vollständigen Suche', () => {
      fc.assert(
        fc.property(hands, ({ deckSize, trump, hand }) => {
          expect(meldPoints(bestMelds(hand, trump, deckSize))).toBe(
            bruteForcePoints(hand, trump, deckSize),
          );
        }),
        { numRuns: 500 },
      );
    });
  });
});

/*
 * Referenz für den Property-Test: zählt alle Kartenmengen auf, die eine Meldeart erfüllen, und
 * sucht je Teilproblem (Rang, Farbe, Spezial) die beste kartendisjunkte Auswahl durch Probieren.
 */
interface Candidate {
  readonly ids: readonly string[];
  readonly points: number;
}

function bruteForcePoints(hand: readonly Card[], trump: Suit, deckSize: DeckSize): number {
  const has = (suit: Suit, rank: Rank) =>
    hand.filter((card) => card.suit === suit && card.rank === rank).map((card) => card.id);
  /** Jede Wahl je eines Exemplars pro Platz. */
  const choose = (slots: string[][]): string[][] =>
    slots.reduce<string[][]>(
      (acc, slot) => acc.flatMap((prefix) => slot.map((id) => [...prefix, id])),
      [[]],
    );
  const all = (slots: string[][], points: number): Candidate[] =>
    choose(slots).map((ids) => ({ ids, points }));
  const bothOf = (slots: string[][], points: number): Candidate[] =>
    slots.every((slot) => slot.length === 2) ? [{ ids: slots.flat(), points }] : [];

  const problems: Candidate[][] = [];
  const setPoints: Partial<Record<Rank, number>> = { unter: 40, ober: 60, koenig: 80, ass: 100 };
  for (const rank of ['unter', 'ober', 'koenig', 'ass'] as const) {
    const slots = SUITS.map((suit) => has(suit, rank));
    problems.push([...all(slots, setPoints[rank]!), ...bothOf(slots, 1000)]);
  }
  for (const suit of SUITS) {
    const isTrump = suit === trump;
    const slots = (['ass', 'zehn', 'koenig', 'ober', 'unter'] as const).map((r) => has(suit, r));
    problems.push([
      ...all([has(suit, 'koenig'), has(suit, 'ober')], isTrump ? 40 : 20),
      ...all(slots, isTrump ? 150 : 100),
      ...bothOf(slots, 1000),
    ]);
  }
  const binokel = [has('schellen', 'unter'), has('gruen', 'ober')];
  problems.push([
    ...all(binokel, 40),
    ...bothOf(binokel, 300),
    ...(deckSize === 48 ? has(trump, 'sieben').map((id) => ({ ids: [id], points: 10 })) : []),
  ]);

  return problems.reduce((sum, candidates) => sum + bestDisjoint(candidates, 0, new Set()), 0);
}

function bestDisjoint(candidates: readonly Candidate[], from: number, used: Set<string>): number {
  let best = 0;
  for (let index = from; index < candidates.length; index++) {
    const { ids, points } = candidates[index];
    if (ids.some((id) => used.has(id))) continue;
    const next = new Set([...used, ...ids]);
    best = Math.max(best, points + bestDisjoint(candidates, index + 1, next));
  }
  return best;
}
