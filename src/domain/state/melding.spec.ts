import { describe, expect, it } from 'vitest';
import { makeCard } from '../cards/card';
import { NO_SPECIAL_RULES, type GameConfig, type PlayerCount } from '../config/game-config';
import type { DeclareMode, RoundState } from './game-state';
import { mayMeld, nextMelder, offeredMelds, submitMelds, type MeldResult } from './melding';

const herzKoenig = makeCard('herz', 'koenig', 1);
const herzOber = makeCard('herz', 'ober', 1);
const schellenUnter = makeCard('schellen', 'unter', 2);
const gruenOber = makeCard('gruen', 'ober', 1);

const configFor = (playerCount: PlayerCount): GameConfig => ({
  playerCount,
  deckSize: 40,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
});

/** Spielmacher 1 hat Herz-Trumpf angesagt; Sitz 0 hält Paar und Binokel. */
function round(playerCount: PlayerCount, mode: DeclareMode = 'play'): RoundState {
  const hands = Array.from({ length: playerCount }, () => [makeCard('eichel', 'ass', 1)]);
  hands[0] = [herzKoenig, herzOber, schellenUnter, gruenOber];
  return {
    dealer: 0,
    forehand: 1,
    hands,
    dabb: [],
    dabbStatus: 'discarded',
    discarded: [],
    bidding: { highestBid: 150, highestBidder: 1, passed: [], activeSeat: null },
    declarer: 1,
    declaration: { trump: 'herz', mode },
    melds: hands.map(() => null),
    trick: [],
    tricks: [],
    result: null,
    ready: [],
  };
}

function ok(result: MeldResult): RoundState {
  if (!result.ok) throw new Error(`Unerwarteter Fehler ${result.code}`);
  return result.round;
}

/** Lässt die Sitze der Reihe nach ohne Meldung durch und merkt sich die Reihenfolge. */
function order(start: RoundState, config: GameConfig): number[] {
  const seats: number[] = [];
  let current = start;
  for (let seat = nextMelder(current, config.playerCount); seat !== null;) {
    seats.push(seat);
    current = ok(submitMelds(current, seat, [], config));
    seat = nextMelder(current, config.playerCount);
  }
  return seats;
}

describe('Meldereihenfolge', () => {
  it.each<[PlayerCount, DeclareMode, number[]]>([
    [3, 'play', [1, 2, 0]],
    [4, 'play', [1, 2, 3, 0]],
    [3, 'abgehen', [2, 0]],
    // Bei 4 Spielern meldet beim Abgehen auch der Partner (Sitz 3) des Spielmachers nicht.
    [4, 'abgehen', [2, 0]],
  ])('beginnt bei %i Spielern (%s) beim Spielmacher in Spielrichtung', (n, mode, expected) => {
    expect(order(round(n, mode), configFor(n))).toEqual(expected);
  });

  it('kennt vor der Ansage keinen Meldeberechtigten', () => {
    const before = { ...round(3), declaration: null };
    expect(mayMeld(before, 0, 3)).toBe(false);
    expect(nextMelder(before, 3)).toBeNull();
    expect(nextMelder({ ...round(3), declarer: null }, 3)).toBeNull();
    expect(offeredMelds(before, 0, configFor(3))).toEqual([]);
  });
});

describe('submitMelds', () => {
  const config = configFor(3);
  /** Sitz 1 hat schon gemeldet, Sitz 2 hat nichts; jetzt ist Sitz 0 dran. */
  const atSeat0 = () => ok(submitMelds(ok(submitMelds(round(3), 1, [], config)), 2, [], config));

  it('bietet die punktehöchste Auswahl der Hand an', () => {
    expect(offeredMelds(atSeat0(), 0, config).map((meld) => [meld.id, meld.points])).toEqual([
      ['paar-herz-1', 40],
      ['binokel', 40],
    ]);
  });

  it('nimmt den ganzen Vorschlag an und meldet ihn öffentlich', () => {
    const before = atSeat0();
    const offered = offeredMelds(before, 0, config);
    const result = submitMelds(before, 0, ['binokel', 'paar-herz-1'], config);

    expect(result).toMatchObject({
      ok: true,
      events: [{ type: 'meldsSubmitted', seat: 0, melds: offered, points: 80 }],
    });
    expect(ok(result).melds[0]).toEqual({ melds: offered, points: 80 });
  });

  it('erlaubt, Meldungen wegzulassen', () => {
    const done = ok(submitMelds(atSeat0(), 0, ['binokel'], config));

    expect(done.melds[0]).toMatchObject({ melds: [{ id: 'binokel' }], points: 40 });
    expect(done.melds[1]).toEqual({ melds: [], points: 0 });
  });

  it.each<[string, number, string[], string]>([
    ['anderer Sitz', 1, [], 'NOT_YOUR_TURN'],
    ['doppelte Meldung', 0, ['binokel', 'binokel'], 'DUPLICATE_MELDS'],
    ['nicht angeboten', 0, ['familie-herz'], 'MELD_NOT_OFFERED'],
    ['unbekannt', 0, ['paar-herz-2'], 'MELD_NOT_OFFERED'],
  ])('weist ab: %s', (_, seat, meldIds, code) => {
    expect(submitMelds(atSeat0(), seat, meldIds, config)).toEqual({ ok: false, code });
  });

  it('lässt keinen Sitz zweimal melden', () => {
    expect(submitMelds(ok(submitMelds(round(3), 1, [], config)), 1, [], config)).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
  });
});
