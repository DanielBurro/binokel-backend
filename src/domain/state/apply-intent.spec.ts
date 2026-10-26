import { describe, expect, it } from 'vitest';
import type { Card } from '../cards/card';
import { buildDeck } from '../cards/deck';
import { NO_SPECIAL_RULES, type GameConfig } from '../config/game-config';
import { applyIntent } from './apply-intent';
import { OPENING_BID } from './bidding';
import { createGame, type GameState } from './game-state';
import { SYSTEM, type Actor, type Intent, type IntentResult } from './intents';

const config: GameConfig = {
  playerCount: 3,
  deckSize: 40,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function ok(result: IntentResult): GameState {
  if (!result.ok) throw new Error(`Unerwarteter Fehler ${result.code}`);
  return result.state;
}

/** Wendet Intents nacheinander auf einen eingefrorenen Zustand an. */
function play(state: GameState, ...moves: [Actor, Intent][]): GameState {
  return moves.reduce(
    (current, [actor, intent]) => ok(applyIntent(deepFreeze(current), actor, intent)),
    state,
  );
}

const startRound = (shuffledDeck: readonly Card[] = buildDeck(40)): [Actor, Intent] => [
  SYSTEM,
  { type: 'startRound', shuffledDeck },
];

/** Geber 0, Vorhand 1, zuerst ist Sitz 2 am Zug. */
const started = (): GameState => play(createGame(config, 0), startRound());

describe('applyIntent', () => {
  describe('startRound', () => {
    it('teilt aus, eröffnet das Reizen und erhöht die Version', () => {
      const result = applyIntent(deepFreeze(createGame(config, 0)), SYSTEM, startRound()[1]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { state, events } = result;
      expect(state).toMatchObject({ version: 1, phase: 'bidding', dealer: 0 });
      expect(state.round).toMatchObject({
        dealer: 0,
        forehand: 1,
        declarer: null,
        bidding: { highestBid: OPENING_BID, highestBidder: 1, passed: [], activeSeat: 2 },
      });
      expect(events).toEqual([{ type: 'roundStarted', dealer: 0, forehand: 1 }]);

      const dealt = [...state.round!.hands.flat(), ...state.round!.dabb].map((card) => card.id);
      expect(dealt.sort()).toEqual(
        buildDeck(40)
          .map((card) => card.id)
          .sort(),
      );
    });

    it.each([
      ['zu wenige Karten', buildDeck(40).slice(1)],
      ['falsche Blattgröße', buildDeck(48)],
      ['doppelte Karte', [...buildDeck(40).slice(1), buildDeck(40)[1]]],
    ])('weist ein unvollständiges Blatt ab (%s)', (_, deck) => {
      expect(applyIntent(createGame(config, 0), SYSTEM, startRound(deck)[1])).toEqual({
        ok: false,
        code: 'INVALID_DECK',
      });
    });

    it('startet keine zweite Runde mitten im Spiel', () => {
      expect(applyIntent(started(), SYSTEM, startRound()[1])).toEqual({
        ok: false,
        code: 'WRONG_PHASE',
      });
    });
  });

  describe('Reizen', () => {
    it('bestimmt den Spielmacher und wechselt in die Dabb-Phase', () => {
      const state = play(
        started(),
        [2, { type: 'bid', amount: 160 }],
        [0, { type: 'pass' }],
        [1, { type: 'bid', amount: 180 }],
        [2, { type: 'pass' }],
      );

      expect(state).toMatchObject({ version: 5, phase: 'dabb' });
      expect(state.round).toMatchObject({
        declarer: 1,
        bidding: { highestBid: 180, highestBidder: 1, activeSeat: null },
      });
    });

    it('liefert die Ereignisse des Zuges', () => {
      const state = play(started(), [2, { type: 'pass' }]);
      const result = applyIntent(state, 0, { type: 'pass' });

      expect(result.ok && result.events).toEqual([
        { type: 'passed', seat: 0 },
        { type: 'biddingWon', declarer: 1, bid: OPENING_BID },
      ]);
    });

    it('lässt den Zustand bei Regelverstößen unverändert', () => {
      const state = deepFreeze(started());

      expect(applyIntent(state, 0, { type: 'pass' })).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
      expect(applyIntent(state, 2, { type: 'bid', amount: 155 })).toEqual({
        ok: false,
        code: 'BID_TOO_LOW',
      });
      expect(state.version).toBe(1);
    });

    it('nimmt nach dem Reizen keine Gebote mehr an', () => {
      const state = play(started(), [2, { type: 'pass' }], [0, { type: 'pass' }]);
      expect(applyIntent(state, 1, { type: 'bid', amount: 160 })).toEqual({
        ok: false,
        code: 'WRONG_PHASE',
      });
    });

    it('nimmt vor der ersten Runde keine Gebote an', () => {
      expect(applyIntent(createGame(config, 0), 1, { type: 'pass' })).toEqual({
        ok: false,
        code: 'WRONG_PHASE',
      });
    });
  });

  describe('Akteure', () => {
    it.each<[string, Actor, Intent]>([
      ['Spieler mit System-Intent', 0, startRound()[1]],
      ['Spieler bricht ab', 0, { type: 'abortGame', reason: 'PLAYER_LEFT' }],
      ['System mit Spieler-Intent', SYSTEM, { type: 'pass' }],
      ['Sitz außerhalb', 3, { type: 'pass' }],
      ['negativer Sitz', -1, { type: 'pass' }],
    ])('weist ab: %s', (_, actor, intent) => {
      expect(applyIntent(started(), actor, intent)).toEqual({ ok: false, code: 'INVALID_ACTOR' });
    });
  });

  describe('abortGame', () => {
    const abort: [Actor, Intent] = [SYSTEM, { type: 'abortGame', reason: 'PLAYER_LEFT' }];

    it('beendet ein laufendes Spiel mit Grund', () => {
      const result = applyIntent(deepFreeze(started()), ...abort);

      expect(result).toMatchObject({
        ok: true,
        state: { phase: 'terminated', abortReason: 'PLAYER_LEFT', version: 2 },
        events: [{ type: 'gameAborted', reason: 'PLAYER_LEFT' }],
      });
    });

    it('lässt danach keine Intents mehr zu', () => {
      const state = play(started(), abort);

      expect(applyIntent(state, ...abort)).toEqual({ ok: false, code: 'WRONG_PHASE' });
      expect(applyIntent(state, 2, { type: 'pass' })).toEqual({ ok: false, code: 'WRONG_PHASE' });
      expect(applyIntent(state, ...startRound())).toEqual({ ok: false, code: 'WRONG_PHASE' });
    });
  });
});
