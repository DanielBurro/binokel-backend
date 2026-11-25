import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeCard, SUITS, type Card, type Rank, type Suit } from '../cards/card';
import { buildDeck } from '../cards/deck';
import { beats, leadingPlay, legalCards, type TrickPlay } from './trick';

const c = (suit: Suit, rank: Rank, copy: 1 | 2 = 1): Card => makeCard(suit, rank, copy);
/** Legt die Karten der Reihe nach von Sitz 0 an. */
const trick = (...cards: Card[]): TrickPlay[] => cards.map((card, seat) => ({ seat, card }));
const ids = (cards: readonly Card[]) => cards.map((card) => card.id);

// Trumpf ist in allen Tabellen Herz.
const T: Suit = 'herz';

describe('beats', () => {
  it.each<[string, Card, Card, boolean]>([
    ['höherer Rang gleicher Farbe', c('eichel', 'zehn'), c('eichel', 'koenig'), true],
    ['niedrigerer Rang gleicher Farbe', c('eichel', 'ober'), c('eichel', 'koenig'), false],
    ['identische Karte', c('eichel', 'ass', 2), c('eichel', 'ass', 1), false],
    ['Trumpf gegen Fehlfarbe', c('herz', 'sieben'), c('eichel', 'ass'), true],
    ['Fehlfarbe gegen Trumpf', c('eichel', 'ass'), c('herz', 'sieben'), false],
    ['fremde Fehlfarbe', c('gruen', 'ass'), c('eichel', 'unter'), false],
    ['höherer Trumpf', c('herz', 'ass'), c('herz', 'zehn'), true],
  ])('%s', (_, card, other, expected) => {
    expect(beats(card, other, T)).toBe(expected);
  });
});

describe('leadingPlay', () => {
  it.each<[string, TrickPlay[], number]>([
    [
      'höchste Karte der angespielten Farbe',
      trick(c('eichel', 'koenig'), c('eichel', 'ass'), c('eichel', 'zehn')),
      1,
    ],
    [
      'abgeworfene Fehlfarbe sticht nie',
      trick(c('eichel', 'unter'), c('gruen', 'ass'), c('schellen', 'ass')),
      0,
    ],
    ['Trumpf sticht', trick(c('eichel', 'ass'), c('herz', 'unter'), c('eichel', 'zehn')), 1],
    ['höherer Trumpf sticht', trick(c('eichel', 'ass'), c('herz', 'unter'), c('herz', 'ober')), 2],
    [
      'zuerst gelegte identische Karte',
      trick(c('gruen', 'ober'), c('gruen', 'ass', 2), c('gruen', 'ass', 1)),
      1,
    ],
  ])('%s', (_, plays, winner) => {
    expect(leadingPlay(plays, T).seat).toBe(winner);
  });

  it('kennt für einen leeren Stich keinen Gewinner', () => {
    expect(() => leadingPlay([], T)).toThrow(RangeError);
  });
});

describe('legalCards (Zwangshierarchie)', () => {
  const hand = [
    c('eichel', 'ass'),
    c('eichel', 'unter'),
    c('herz', 'zehn'),
    c('herz', 'unter'),
    c('gruen', 'koenig'),
  ];

  it.each<[string, Card[], TrickPlay[], Card[]]>([
    ['Eröffnung: alles erlaubt', hand, [], hand],
    ['Farbzwang mit Stichzwang', hand, trick(c('eichel', 'zehn')), [c('eichel', 'ass')]],
    [
      'Farbzwang, Stechen unmöglich',
      hand,
      trick(c('eichel', 'ass', 2)),
      [c('eichel', 'ass'), c('eichel', 'unter')],
    ],
    [
      'abgestochene Fehlfarbe: nur bedienen, Stichzwang entfällt',
      hand,
      trick(c('eichel', 'koenig'), c('herz', 'sieben')),
      [c('eichel', 'ass'), c('eichel', 'unter')],
    ],
    [
      'Trumpfzwang ohne Trumpf im Stich',
      hand,
      trick(c('schellen', 'ass')),
      [c('herz', 'zehn'), c('herz', 'unter')],
    ],
    [
      'Trumpfzwang mit Überstechen',
      hand,
      trick(c('schellen', 'ass'), c('herz', 'ober')),
      [c('herz', 'zehn')],
    ],
    [
      'Trumpfzwang, Überstechen unmöglich: jeder Trumpf',
      hand,
      trick(c('schellen', 'ass'), c('herz', 'ass')),
      [c('herz', 'zehn'), c('herz', 'unter')],
    ],
    ['Trumpf angespielt: höherer Trumpf', hand, trick(c('herz', 'ober')), [c('herz', 'zehn')]],
    [
      'weder bedienen noch trumpfen: beliebige Karte',
      [c('eichel', 'ass'), c('gruen', 'koenig')],
      trick(c('schellen', 'zehn')),
      [c('eichel', 'ass'), c('gruen', 'koenig')],
    ],
  ])('%s', (_, ownHand, plays, expected) => {
    expect(ids(legalCards(ownHand, plays, T))).toEqual(ids(expected));
  });

  describe('Eigenschaften', () => {
    // Zufällige Hand und ein Stich aus 1 bis 3 anderen Karten, alles aus einem Blatt.
    const situations = fc
      .tuple(
        fc.constantFrom(...SUITS),
        fc.shuffledSubarray(buildDeck(48), { minLength: 2, maxLength: 19 }),
      )
      .chain(([trump, cards]) =>
        fc.integer({ min: 1, max: Math.min(3, cards.length - 1) }).map((played) => ({
          trump,
          plays: trick(...cards.slice(0, played)),
          hand: cards.slice(played),
        })),
      );

    it('erlaubt immer mindestens eine Karte und nur eigene', () => {
      fc.assert(
        fc.property(situations, ({ trump, plays, hand }) => {
          const legal = legalCards(hand, plays, trump);
          expect(legal.length).toBeGreaterThan(0);
          for (const card of legal) expect(hand).toContain(card);
        }),
      );
    });

    it('setzt Farbzwang vor Trumpfzwang und dann den Stichzwang durch', () => {
      fc.assert(
        fc.property(situations, ({ trump, plays, hand }) => {
          const legal = legalCards(hand, plays, trump);
          const led = plays[0].card.suit;
          const lead = leadingPlay(plays, trump).card;
          const pool = hand.some((card) => card.suit === led)
            ? hand.filter((card) => card.suit === led)
            : hand.some((card) => card.suit === trump)
              ? hand.filter((card) => card.suit === trump)
              : hand;

          // Nur Karten aus der Pflichtmenge, und wer stechen kann, muss.
          for (const card of legal) expect(pool).toContain(card);
          const canOvertake = pool.some((card) => beats(card, lead, trump));
          for (const card of pool) {
            expect(legal.includes(card)).toBe(!canOvertake || beats(card, lead, trump));
          }
        }),
      );
    });
  });
});
