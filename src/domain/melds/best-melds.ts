import type { Card, Rank, Suit } from '../cards/card';
import { SUITS } from '../cards/card';
import type { DeckSize } from '../config/game-config';
import type { Meld, MeldKind } from './meld';

/** Ränge, die Vier und Acht Gleiche bilden; Zehnen und Siebenen zählen nicht. */
const SET_RANKS = ['unter', 'ober', 'koenig', 'ass'] as const;
type SetRank = (typeof SET_RANKS)[number];
/** Ränge einer Familie (R₄₀ ohne Sieben). */
const FAMILY_RANKS: readonly Rank[] = ['ass', 'zehn', 'koenig', 'ober', 'unter'];

const FOUR_OF_A_KIND_POINTS: Readonly<Record<SetRank, number>> = {
  unter: 40,
  ober: 60,
  koenig: 80,
  ass: 100,
};
const THOUSAND = 1000;
const PAIR_POINTS = { plain: 20, trump: 40 };
const FAMILY_POINTS = { plain: 100, trump: 150 };
const BINOKEL_POINTS = 40;
const DOUBLE_BINOKEL_POINTS = 300;
const DISS_POINTS = 10;

/**
 * Punktehöchste gültige Meldeauswahl einer Hand (Studienarbeit, Phase 5). Je Gruppe sind die
 * Kartenmengen disjunkt, zwischen den Gruppen darf eine Karte mehrfach zählen. Weil die Gruppen
 * unabhängig sind, zerfällt das Maximum in Teilprobleme je Rang (Sätze), je Farbe (Sequenzen)
 * und für die Spezial-Meldungen. Gleich gute Alternativen löst die Funktion deterministisch auf:
 * Sie nimmt jeweils zuerst Exemplar 1.
 */
export function bestMelds(hand: readonly Card[], trump: Suit, deckSize: DeckSize): Meld[] {
  return [...sets(hand), ...sequences(hand, trump), ...specials(hand, trump, deckSize)];
}

/** Acht Gleiche (1000) schlägt zweimal Vier Gleiche, deshalb zuerst prüfen. */
function sets(hand: readonly Card[]): Meld[] {
  return SET_RANKS.flatMap((rank) => {
    const bySuit = SUITS.map((suit) => copies(hand, suit, rank));
    if (bySuit.every((cards) => cards.length === 2)) {
      return [meld('achtGleiche', rank, bySuit.flat(), THOUSAND)];
    }
    if (bySuit.every((cards) => cards.length >= 1)) {
      return [
        meld(
          'vierGleiche',
          rank,
          bySuit.map((cards) => cards[0]),
          FOUR_OF_A_KIND_POINTS[rank],
        ),
      ];
    }
    return [];
  });
}

/**
 * Je Farbe: Doppelte Familie (1000) vor Familie, eine Familie (100) vor einem Paar (20), weil sie
 * König und Ober nur einmal braucht. Übrige Könige und Ober bilden Paare.
 */
function sequences(hand: readonly Card[], trump: Suit): Meld[] {
  return SUITS.flatMap((suit) => {
    const byRank = FAMILY_RANKS.map((rank) => copies(hand, suit, rank));
    if (byRank.every((cards) => cards.length === 2)) {
      return [meld('doppelteFamilie', suit, byRank.flat(), THOUSAND)];
    }
    const isTrump = suit === trump;
    const melds: Meld[] = [];
    let used = 0;
    if (byRank.every((cards) => cards.length >= 1)) {
      const points = isTrump ? FAMILY_POINTS.trump : FAMILY_POINTS.plain;
      melds.push(
        meld(
          'familie',
          suit,
          byRank.map((cards) => cards[0]),
          points,
        ),
      );
      used = 1;
    }
    const kings = copies(hand, suit, 'koenig');
    const obers = copies(hand, suit, 'ober');
    for (let index = used; index < Math.min(kings.length, obers.length); index++) {
      const points = isTrump ? PAIR_POINTS.trump : PAIR_POINTS.plain;
      melds.push(meld('paar', `${suit}-${index + 1 - used}`, [kings[index], obers[index]], points));
    }
    return melds;
  });
}

/** Doppel-Binokel (300) schlägt zwei Binokel; Diß nur mit Siebenen, also bei 48 Karten. */
function specials(hand: readonly Card[], trump: Suit, deckSize: DeckSize): Meld[] {
  const melds: Meld[] = [];
  const unters = copies(hand, 'schellen', 'unter');
  const obers = copies(hand, 'gruen', 'ober');
  if (unters.length === 2 && obers.length === 2) {
    melds.push(meld('doppelBinokel', null, [...unters, ...obers], DOUBLE_BINOKEL_POINTS));
  } else if (unters.length >= 1 && obers.length >= 1) {
    melds.push(meld('binokel', null, [unters[0], obers[0]], BINOKEL_POINTS));
  }
  if (deckSize === 48) {
    copies(hand, trump, 'sieben').forEach((card) => {
      melds.push(meld('diss', String(card.copy), [card], DISS_POINTS));
    });
  }
  return melds;
}

/** Karten einer Farbe und eines Rangs, Exemplar 1 zuerst. */
function copies(hand: readonly Card[], suit: Suit, rank: Rank): Card[] {
  return hand
    .filter((card) => card.suit === suit && card.rank === rank)
    .sort((a, b) => a.copy - b.copy);
}

function meld(kind: MeldKind, key: string | null, cards: readonly Card[], points: number): Meld {
  return { id: key === null ? kind : `${kind}-${key}`, kind, cards: [...cards], points };
}
