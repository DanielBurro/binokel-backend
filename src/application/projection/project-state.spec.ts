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
      activeSeat: null,
      scores: [0, 0, 0],
      abortReason: null,
      availableActions: { intents: [], bidRange: null },
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

  it('bietet nur dem Sitz am Zug Gebot und Passen an', () => {
    const state = play(started(config), [2, { type: 'bid', amount: 160 }]);

    expect(projectStateFor(state, 0, seats).availableActions).toEqual({
      intents: ['bid', 'pass'],
      bidRange: { min: 170, max: MAX_BID, step: BID_STEP },
    });
    expect(projectStateFor(state, 1, seats).availableActions).toEqual({
      intents: [],
      bidRange: null,
    });
  });

  it('zeigt nach dem Reizen den Spielmacher und bietet keine Gebote mehr an', () => {
    const state = play(started(config), [2, { type: 'pass' }], [0, { type: 'pass' }]);
    const view = projectStateFor(state, 1, seats);

    expect(view).toMatchObject({
      phase: 'dabb',
      declarer: 1,
      activeSeat: null,
      bidding: { highestBid: OPENING_BID, highestBidder: 1, passed: [2, 0] },
      availableActions: { intents: [], bidRange: null },
    });
  });

  it('zeigt nach einem Abbruch den Grund', () => {
    const state = play(started(config), [SYSTEM, { type: 'abortGame', reason: 'PLAYER_LEFT' }]);
    const view = projectStateFor(state, 2, seats);

    expect(view).toMatchObject({
      phase: 'terminated',
      abortReason: 'PLAYER_LEFT',
      activeSeat: null,
      availableActions: { intents: [], bidRange: null },
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

    it.each(configs)(
      'verrät bei %i Spielern und %i Karten weder Dabb noch fremde Hände',
      (n, d) => {
        const leakConfig = configFor(n, d);
        const begun = started(leakConfig);
        const states = [
          begun,
          play(begun, [2, { type: 'bid', amount: OPENING_BID + BID_STEP }]),
          play(begun, [SYSTEM, { type: 'abortGame', reason: 'PLAYER_LEFT' }]),
        ];

        for (const state of states) {
          const { hands, dabb } = state.round!;
          for (let seat: Seat = 0; seat < n; seat++) {
            const json = JSON.stringify(projectStateFor(state, seat, seatsFor(n)));
            const hidden = [...dabb, ...hands.filter((_, other) => other !== seat).flat()];

            expect(dabb.length).toBeGreaterThan(0);
            for (const card of hidden) {
              expect(json).not.toContain(`"${card.id}"`);
            }
            for (const card of hands[seat]) {
              expect(json).toContain(`"${card.id}"`);
            }
          }
        }
      },
    );
  });
});
