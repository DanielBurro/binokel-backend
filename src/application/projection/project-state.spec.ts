import { describe, expect, it } from 'vitest';
import { buildDeck } from '../../domain/cards/deck';
import {
  NO_SPECIAL_RULES,
  type DeckSize,
  type GameConfig,
  type PlayerCount,
} from '../../domain/config/game-config';
import type { Seat } from '../../domain/rules/parties';
import { applyIntent } from '../../domain/state/apply-intent';
import { BID_STEP, MAX_BID, OPENING_BID } from '../../domain/state/bidding';
import { createGame, type GameState } from '../../domain/state/game-state';
import { SYSTEM, type Actor, type Intent } from '../../domain/state/intents';
import type { SeatInfo } from './player-view';
import { projectStateFor } from './project-state';

const configFor = (playerCount: PlayerCount, deckSize: DeckSize): GameConfig => ({
  playerCount,
  deckSize,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
});

const seatsFor = (playerCount: number): SeatInfo[] =>
  Array.from({ length: playerCount }, (_, seat) => ({
    displayName: `Spieler ${seat}`,
    connected: seat !== 1,
  }));

function play(state: GameState, ...moves: [Actor, Intent][]): GameState {
  return moves.reduce((current, [actor, intent]) => {
    const result = applyIntent(current, actor, intent);
    if (!result.ok) throw new Error(`Unerwarteter Fehler ${result.code}`);
    return result.state;
  }, state);
}

/** Geber 0, Vorhand 1, zuerst ist Sitz 2 am Zug. */
function started(config: GameConfig): GameState {
  return play(createGame(config, 0), [
    SYSTEM,
    { type: 'startRound', shuffledDeck: buildDeck(config.deckSize) },
  ]);
}

const config = configFor(3, 40);
const seats = seatsFor(3);

describe('projectStateFor', () => {
  it('zeigt vor der ersten Runde Sitze und Punkte, aber keine Karten', () => {
    const view = projectStateFor(createGame(config, 0), 1, seats);

    expect(view).toEqual({
      version: 0,
      phase: 'created',
      config,
      ownSeat: 1,
      seats: [
        { seat: 0, party: 0, displayName: 'Spieler 0', connected: true, handSize: 0 },
        { seat: 1, party: 1, displayName: 'Spieler 1', connected: false, handSize: 0 },
        { seat: 2, party: 2, displayName: 'Spieler 2', connected: true, handSize: 0 },
      ],
      hand: [],
      dealer: 0,
      forehand: null,
      bidding: null,
      declarer: null,
      dabb: null,
      declaration: null,
      melds: [null, null, null],
      trick: null,
      lastTrick: null,
      roundResult: null,
      readySeats: [],
      activeSeat: null,
      scores: [0, 0, 0],
      abortReason: null,
      winners: null,
      availableActions: [],
    });
  });

  it('zeigt beim Reizen die eigene Hand, Handgrößen und den Reizstand', () => {
    const state = started(config);
    const view = projectStateFor(state, 0, seats);

    expect(view).toMatchObject({
      version: 1,
      phase: 'bidding',
      ownSeat: 0,
      forehand: 1,
      bidding: { highestBid: OPENING_BID, highestBidder: 1, passed: [] },
      activeSeat: 2,
    });
    expect(view.hand).toEqual(state.round!.hands[0]);
    expect(view.seats.map((seat) => seat.handSize)).toEqual([12, 12, 12]);
  });

  it('zeigt beim Reizen allen nur Größe und Lage des Dabbs', () => {
    const bidding = started(config);
    const decided = play(bidding, [2, { type: 'pass' }], [0, { type: 'pass' }]);

    for (const state of [bidding, decided]) {
      for (const seat of [0, 1, 2]) {
        expect(projectStateFor(state, seat, seats).dabb).toEqual({
          size: 4,
          status: 'table',
          cards: null,
        });
      }
    }
    expect(projectStateFor(started(configFor(3, 48)), 0, seats).dabb?.size).toBe(3);
  });

  describe('Dabb nach der Aufnahme (nur für den Spielmacher)', () => {
    // Sitz 1 wird Spielmacher und nimmt auf.
    const taken = () =>
      play(
        started(config),
        [2, { type: 'pass' }],
        [0, { type: 'pass' }],
        [1, { type: 'takeDabb' }],
      );

    it('zeigt dem Spielmacher die aufgenommenen Karten, den anderen nicht', () => {
      const state = taken();

      expect(projectStateFor(state, 1, seats)).toMatchObject({
        dabb: { size: 4, status: 'taken', cards: state.round!.dabb },
        availableActions: [{ type: 'discardToDabb', count: 4 }],
      });
      expect(projectStateFor(state, 1, seats).hand).toHaveLength(16);
      for (const seat of [0, 2]) {
        expect(projectStateFor(state, seat, seats).dabb).toEqual({
          size: 4,
          status: 'taken',
          cards: null,
        });
        expect(projectStateFor(state, seat, seats).seats[1].handSize).toBe(16);
      }
    });

    it('zeigt dem Spielmacher nach dem Drücken die gedrückten Karten, den anderen nicht', () => {
      const before = taken();
      const pressed = before.round!.hands[1].slice(-4);
      const state = play(before, [
        1,
        { type: 'discardToDabb', cardIds: pressed.map((card) => card.id) },
      ]);

      expect(projectStateFor(state, 1, seats)).toMatchObject({
        phase: 'declare',
        dabb: { size: 4, status: 'discarded', cards: pressed },
        activeSeat: 1,
        availableActions: [{ type: 'declare', modes: ['play', 'abgehen'] }],
      });
      for (const seat of [0, 2]) {
        expect(projectStateFor(state, seat, seats).dabb).toEqual({
          size: 4,
          status: 'discarded',
          cards: null,
        });
      }
    });
  });

  it('zeigt allen Sitzen Trumpf und Spielart, sobald angesagt ist', () => {
    const taken = play(
      started(config),
      [2, { type: 'pass' }],
      [0, { type: 'pass' }],
      [1, { type: 'takeDabb' }],
    );
    const discarded = play(taken, [
      1,
      { type: 'discardToDabb', cardIds: taken.round!.hands[1].slice(0, 4).map((c) => c.id) },
    ]);
    const declared = play(discarded, [1, { type: 'declare', trump: 'schellen', mode: 'abgehen' }]);

    for (const seat of [0, 1, 2]) {
      expect(projectStateFor(discarded, seat, seats).declaration).toBeNull();
      expect(projectStateFor(declared, seat, seats)).toMatchObject({
        phase: 'meld',
        declaration: { trump: 'schellen', mode: 'abgehen' },
      });
    }
    expect(projectStateFor(declared, 1, seats).declaration).not.toBe(declared.round!.declaration);
  });

  it('lässt die Felder der späteren Phasen leer, bis ihre Regeln umgesetzt sind', () => {
    const state = play(started(configFor(4, 48)), [2, { type: 'pass' }]);

    expect(projectStateFor(state, 3, seatsFor(4))).toMatchObject({
      declaration: null,
      melds: [null, null, null, null],
      trick: null,
      lastTrick: null,
      roundResult: null,
      readySeats: [],
      winners: null,
    });
  });

  it('bietet nur dem Sitz am Zug Gebot und Passen an', () => {
    const state = play(started(config), [2, { type: 'bid', amount: 160 }]);

    expect(projectStateFor(state, 0, seats).availableActions).toEqual([
      { type: 'bid', min: 170, max: MAX_BID, step: BID_STEP },
      { type: 'pass' },
    ]);
    expect(projectStateFor(state, 1, seats).availableActions).toEqual([]);
  });

  it('zeigt nach dem Reizen den Spielmacher und bietet nur ihm den Dabb an', () => {
    const state = play(started(config), [2, { type: 'pass' }], [0, { type: 'pass' }]);
    const view = projectStateFor(state, 1, seats);

    expect(view).toMatchObject({
      phase: 'dabb',
      declarer: 1,
      activeSeat: 1,
      bidding: { highestBid: OPENING_BID, highestBidder: 1, passed: [2, 0] },
      availableActions: [{ type: 'takeDabb' }],
    });
    expect(projectStateFor(state, 0, seats).availableActions).toEqual([]);
  });

  it('zeigt nach einem Abbruch den Grund', () => {
    const state = play(started(config), [SYSTEM, { type: 'abortGame', reason: 'PLAYER_LEFT' }]);
    const view = projectStateFor(state, 2, seats);

    expect(view).toMatchObject({
      phase: 'terminated',
      abortReason: 'PLAYER_LEFT',
      activeSeat: null,
      availableActions: [],
    });
  });

  it('teilt keine Referenzen mit dem Spielzustand', () => {
    const state = started(config);
    const view = projectStateFor(state, 0, seats);

    expect(view.hand[0]).not.toBe(state.round!.hands[0][0]);
    expect(view.scores).not.toBe(state.scores);
    expect(view.config).not.toBe(state.config);
    expect(view.config.specialRules).not.toBe(state.config.specialRules);
  });

  it('weist ungültige Sitze und unpassende Sitzinfos ab', () => {
    const state = started(config);

    expect(() => projectStateFor(state, 3, seats)).toThrow(RangeError);
    expect(() => projectStateFor(state, 0, seatsFor(4))).toThrow(RangeError);
  });

  describe('Datenleck (FA-05)', () => {
    const configs: [PlayerCount, DeckSize][] = [
      [3, 40],
      [3, 48],
      [4, 40],
      [4, 48],
    ];

    /** Was der Sitz sehen darf: eigene Hand, als Spielmacher dazu den aufgenommenen Dabb. */
    function visibleTo(state: GameState, seat: Seat): Set<string> {
      const { hands, dabb, discarded, dabbStatus, declarer } = state.round!;
      const own = [...hands[seat]];
      if (seat === declarer && dabbStatus !== 'table') own.push(...dabb, ...discarded);
      return new Set(own.map((card) => card.id));
    }

    it.each(configs)(
      'verrät bei %i Spielern und %i Karten weder Dabb noch fremde Hände',
      (n, d) => {
        const leakConfig = configFor(n, d);
        const begun = started(leakConfig);
        // Sitz 2 bietet 1000 und wird Spielmacher, nimmt auf, drückt und sagt an.
        const decided = play(begun, [2, { type: 'bid', amount: MAX_BID }]);
        const taken = play(decided, [2, { type: 'takeDabb' }]);
        const discarded = play(taken, [
          2,
          {
            type: 'discardToDabb',
            cardIds: taken.round!.hands[2].slice(0, taken.round!.dabb.length).map((c) => c.id),
          },
        ]);
        const states = [
          begun,
          play(begun, [2, { type: 'bid', amount: OPENING_BID + BID_STEP }]),
          decided,
          taken,
          discarded,
          play(discarded, [2, { type: 'declare', trump: 'herz', mode: 'play' }]),
          play(taken, [SYSTEM, { type: 'abortGame', reason: 'PLAYER_LEFT' }]),
        ];

        for (const state of states) {
          for (let seat: Seat = 0; seat < n; seat++) {
            const json = JSON.stringify(projectStateFor(state, seat, seatsFor(n)));
            const visible = visibleTo(state, seat);

            for (const card of buildDeck(d)) {
              if (!visible.has(card.id)) expect(json).not.toContain(`"${card.id}"`);
            }
            for (const card of state.round!.hands[seat]) {
              expect(json).toContain(`"${card.id}"`);
            }
          }
        }
      },
    );
  });
});
