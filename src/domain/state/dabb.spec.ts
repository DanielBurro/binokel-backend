import { describe, expect, it } from 'vitest';
import { makeCard, type Card } from '../cards/card';
import { discardedEyes, discardToDabb, takeDabb, type DabbResult } from './dabb';
import type { RoundState } from './game-state';

const herzAss = makeCard('herz', 'ass', 1);
const herzZehn = makeCard('herz', 'zehn', 1);
const gruenKoenig = makeCard('gruen', 'koenig', 1);
const gruenOber = makeCard('gruen', 'ober', 2);
const eichelUnter = makeCard('eichel', 'unter', 1);
const schellenSieben = makeCard('schellen', 'sieben', 2);

/** Drei Sitze, Spielmacher 1, Dabb mit zwei Karten. */
function round(overrides: Partial<RoundState> = {}): RoundState {
  return {
    dealer: 0,
    forehand: 1,
    hands: [[eichelUnter], [herzAss, gruenKoenig], [schellenSieben]],
    dabb: [herzZehn, gruenOber],
    dabbStatus: 'table',
    discarded: [],
    bidding: { highestBid: 150, highestBidder: 1, passed: [2, 0], activeSeat: null },
    declarer: 1,
    declaration: null,
    melds: [null, null, null],
    trick: [],
    tricks: [],
    result: null,
    ...overrides,
  };
}

function ok(result: DabbResult): RoundState {
  if (!result.ok) throw new Error(`Unerwarteter Fehler ${result.code}`);
  return result.round;
}

const ids = (cards: readonly Card[]) => cards.map((card) => card.id);

describe('takeDabb', () => {
  it('legt den Dabb auf die Hand des Spielmachers und merkt sich seine Karten', () => {
    const result = takeDabb(round(), 1);

    expect(result).toMatchObject({ ok: true, events: [{ type: 'dabbTaken', seat: 1 }] });
    const taken = ok(result);
    expect(taken.dabbStatus).toBe('taken');
    expect(ids(taken.hands[1])).toEqual(ids([herzAss, gruenKoenig, herzZehn, gruenOber]));
    expect(taken.dabb).toEqual([herzZehn, gruenOber]);
    expect(taken.hands[0]).toEqual([eichelUnter]);
    expect(taken.hands[2]).toEqual([schellenSieben]);
  });

  it('lässt nur den Spielmacher aufnehmen, und nur einmal', () => {
    expect(takeDabb(round(), 0)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(takeDabb(ok(takeDabb(round(), 1)), 1)).toEqual({
      ok: false,
      code: 'DABB_ALREADY_TAKEN',
    });
  });
});

describe('discardToDabb', () => {
  const taken = () => ok(takeDabb(round(), 1));

  it('nimmt die gedrückten Karten aus der Hand und legt sie ab', () => {
    const result = discardToDabb(taken(), 1, [herzAss.id, gruenOber.id]);

    expect(result).toMatchObject({ ok: true, events: [{ type: 'dabbDiscarded', seat: 1 }] });
    const done = ok(result);
    expect(done.dabbStatus).toBe('discarded');
    expect(ids(done.discarded)).toEqual(ids([herzAss, gruenOber]));
    expect(ids(done.hands[1])).toEqual(ids([gruenKoenig, herzZehn]));
    expect(done.dabb).toEqual([herzZehn, gruenOber]);
  });

  it.each<[string, number, string[], string]>([
    ['anderer Sitz', 2, [herzAss.id, gruenOber.id], 'NOT_YOUR_TURN'],
    ['zu wenige Karten', 1, [herzAss.id], 'WRONG_DISCARD_COUNT'],
    ['zu viele Karten', 1, [herzAss.id, gruenOber.id, herzZehn.id], 'WRONG_DISCARD_COUNT'],
    ['doppelte Karte', 1, [herzAss.id, herzAss.id], 'DUPLICATE_CARDS'],
    ['fremde Karte', 1, [herzAss.id, eichelUnter.id], 'CARD_NOT_IN_HAND'],
    ['unbekannte Karte', 1, [herzAss.id, 'pik-ass-1'], 'CARD_NOT_IN_HAND'],
  ])('weist ab: %s', (_, seat, cardIds, code) => {
    expect(discardToDabb(taken(), seat, cardIds)).toEqual({ ok: false, code });
  });

  it('verlangt, dass der Dabb vorher aufgenommen wurde', () => {
    expect(discardToDabb(round(), 1, [herzAss.id, gruenKoenig.id])).toEqual({
      ok: false,
      code: 'DABB_NOT_TAKEN',
    });
    const done = ok(discardToDabb(taken(), 1, [herzAss.id, gruenOber.id]));
    expect(discardToDabb(done, 1, [gruenKoenig.id, herzZehn.id])).toEqual({
      ok: false,
      code: 'DABB_NOT_TAKEN',
    });
  });
});

describe('discardedEyes', () => {
  it('zählt die Augen der gedrückten Karten', () => {
    expect(discardedEyes(round())).toBe(0);
    expect(discardedEyes(round({ discarded: [herzAss, gruenOber, schellenSieben] }))).toBe(14);
  });
});
