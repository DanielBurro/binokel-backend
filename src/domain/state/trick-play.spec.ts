import { describe, expect, it } from 'vitest';
import { makeCard, type Card } from '../cards/card';
import { NO_SPECIAL_RULES, type GameConfig } from '../config/game-config';
import type { RoundState } from './game-state';
import { nextPlayer, playableCards, playCard, type TrickResult } from './trick-play';

const config: GameConfig = {
  playerCount: 3,
  deckSize: 40,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
};

const eichelAss = makeCard('eichel', 'ass', 1);
const eichelKoenig = makeCard('eichel', 'koenig', 1);
const eichelZehn = makeCard('eichel', 'zehn', 2);
const gruenZehn = makeCard('gruen', 'zehn', 1);
const herzUnter = makeCard('herz', 'unter', 1);
const schellenAss = makeCard('schellen', 'ass', 1);

/** Geber 0, Vorhand 1, Spielmacher 2 mit Herz-Trumpf; jeder hält noch zwei Karten. */
function round(): RoundState {
  return {
    dealer: 0,
    forehand: 1,
    hands: [
      [schellenAss, eichelZehn],
      [eichelAss, gruenZehn],
      [eichelKoenig, herzUnter],
    ],
    dabb: [],
    dabbStatus: 'discarded',
    discarded: [],
    bidding: { highestBid: 150, highestBidder: 2, passed: [0, 1], activeSeat: null },
    declarer: 2,
    declaration: { trump: 'herz', mode: 'play' },
    melds: [null, null, null],
    trick: [],
    tricks: [],
    result: null,
  };
}

function ok(result: TrickResult): RoundState {
  if (!result.ok) throw new Error(`Unerwarteter Fehler ${result.code}`);
  return result.round;
}

const play = (state: RoundState, seat: number, card: Card) =>
  ok(playCard(state, seat, card.id, config));

describe('Stichspiel', () => {
  it('lässt die Vorhand den ersten Stich ausspielen, danach reihum', () => {
    const start = round();
    expect(nextPlayer(start, 3)).toBe(1);
    expect(nextPlayer(play(start, 1, eichelAss), 3)).toBe(2);
    expect(nextPlayer(play(play(start, 1, eichelAss), 2, eichelKoenig), 3)).toBe(0);
  });

  it('schließt den Stich mit der letzten Karte ab und gibt dem Gewinner das Anspielrecht', () => {
    const before = play(play(round(), 1, eichelAss), 2, eichelKoenig);
    const result = playCard(before, 0, eichelZehn.id, config);

    expect(result).toMatchObject({
      ok: true,
      events: [
        { type: 'cardPlayed', seat: 0, card: eichelZehn },
        { type: 'trickWon', winner: 1 },
      ],
    });
    const done = ok(result);
    expect(done.trick).toEqual([]);
    expect(done.tricks).toEqual([
      {
        plays: [
          { seat: 1, card: eichelAss },
          { seat: 2, card: eichelKoenig },
          { seat: 0, card: eichelZehn },
        ],
        winner: 1,
      },
    ]);
    expect(done.hands).toEqual([[schellenAss], [gruenZehn], [herzUnter]]);
    expect(nextPlayer(done, 3)).toBe(1);
  });

  it('spielt den zweiten Stich mit Trumpfzwang zu Ende', () => {
    const first = play(play(play(round(), 1, eichelAss), 2, eichelKoenig), 0, eichelZehn);
    // Sitz 2 hat kein Grün und muss trumpfen; Sitz 0 hat weder Grün noch Trumpf.
    expect(playableCards(play(first, 1, gruenZehn), 2)).toEqual([herzUnter]);
    const done = play(play(play(first, 1, gruenZehn), 2, herzUnter), 0, schellenAss);

    expect(done.tricks.map((trick) => trick.winner)).toEqual([1, 2]);
    expect(done.hands.flat()).toEqual([]);
  });

  it.each<[string, (state: RoundState) => TrickResult, string]>([
    ['nicht am Zug', (state) => playCard(state, 2, eichelKoenig.id, config), 'NOT_YOUR_TURN'],
    ['fremde Karte', (state) => playCard(state, 1, eichelKoenig.id, config), 'CARD_NOT_IN_HAND'],
    [
      'Farbzwang verletzt',
      (state) => playCard(play(state, 1, eichelAss), 2, herzUnter.id, config),
      'CARD_NOT_ALLOWED',
    ],
    [
      'Farbzwang verletzt, obwohl Stechen unmöglich',
      (state) =>
        playCard(play(play(state, 1, eichelAss), 2, eichelKoenig), 0, schellenAss.id, config),
      'CARD_NOT_ALLOWED',
    ],
    [
      'ohne Ansage',
      (state) => playCard({ ...state, declaration: null }, 1, eichelAss.id, config),
      'WRONG_PHASE',
    ],
  ])('weist ab: %s', (_, attempt, code) => {
    expect(attempt(round())).toEqual({ ok: false, code });
  });

  it('erlaubt ohne Ansage keine Karte', () => {
    expect(playableCards({ ...round(), declaration: null }, 1)).toEqual([]);
  });
});
