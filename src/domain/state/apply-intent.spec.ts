import { describe, expect, it } from 'vitest';
import type { Card } from '../cards/card';
import { buildDeck } from '../cards/deck';
import { NO_SPECIAL_RULES, type GameConfig } from '../config/game-config';
import { applyIntent } from './apply-intent';
import { OPENING_BID } from './bidding';
import { createGame, type DeclareMode, type GameState } from './game-state';
import { legalIntents } from './legal-intents';
import { scoreRound } from './scoring';
import { SYSTEM, type Actor, type Intent, type IntentResult, type PlayerIntent } from './intents';

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

  describe('Dabb', () => {
    /** Sitz 1 wird Spielmacher; mit ungemischtem Blatt liegen 4 Karten im Dabb. */
    const decided = () => play(started(), [2, { type: 'pass' }], [0, { type: 'pass' }]);

    it('lässt den Spielmacher aufnehmen und drücken und wechselt dann zur Ansage', () => {
      const taken = play(decided(), [1, { type: 'takeDabb' }]);
      expect(taken).toMatchObject({ version: 4, phase: 'dabb' });
      expect(taken.round!.hands[1]).toHaveLength(16);

      const discard = taken.round!.hands[1].slice(0, 4);
      const result = applyIntent(deepFreeze(taken), 1, {
        type: 'discardToDabb',
        cardIds: discard.map((card) => card.id),
      });

      expect(result).toMatchObject({
        ok: true,
        state: { version: 5, phase: 'declare' },
        events: [{ type: 'dabbDiscarded', seat: 1 }],
      });
      if (!result.ok) return;
      expect(result.state.round).toMatchObject({ dabbStatus: 'discarded', discarded: discard });
      expect(result.state.round!.hands[1]).toHaveLength(12);
    });

    it('lässt den Zustand bei Regelverstößen unverändert', () => {
      const state = deepFreeze(decided());

      expect(applyIntent(state, 0, { type: 'takeDabb' })).toEqual({
        ok: false,
        code: 'NOT_YOUR_TURN',
      });
      expect(applyIntent(state, 1, { type: 'discardToDabb', cardIds: [] })).toEqual({
        ok: false,
        code: 'DABB_NOT_TAKEN',
      });
      expect(state.version).toBe(3);
    });

    it('nimmt beim Reizen keinen Dabb-Zug an', () => {
      expect(applyIntent(started(), 2, { type: 'takeDabb' })).toEqual({
        ok: false,
        code: 'WRONG_PHASE',
      });
    });
  });

  describe('Ansage', () => {
    /** Sitz 1 ist Spielmacher und hat schon gedrückt. */
    const discarded = () => {
      const taken = play(
        started(),
        [2, { type: 'pass' }],
        [0, { type: 'pass' }],
        [1, { type: 'takeDabb' }],
      );
      return play(taken, [
        1,
        { type: 'discardToDabb', cardIds: taken.round!.hands[1].slice(0, 4).map((c) => c.id) },
      ]);
    };

    it.each(['play', 'abgehen'] as const)(
      'hält Trumpf und Spielart fest und wechselt zum Melden (%s)',
      (mode) => {
        const result = applyIntent(deepFreeze(discarded()), 1, {
          type: 'declare',
          trump: 'eichel',
          mode,
        });

        expect(result).toEqual({
          ok: true,
          state: expect.objectContaining({ version: 6, phase: 'meld' }),
          events: [{ type: 'declared', seat: 1, trump: 'eichel', mode }],
        });
        if (!result.ok) return;
        expect(result.state.round!.declaration).toEqual({ trump: 'eichel', mode });
      },
    );

    it('lässt den Zustand bei Regelverstößen unverändert', () => {
      const state = deepFreeze(discarded());

      expect(applyIntent(state, 2, { type: 'declare', trump: 'herz', mode: 'play' })).toEqual({
        ok: false,
        code: 'NOT_YOUR_TURN',
      });
      expect(state.version).toBe(5);
      expect(state.round!.declaration).toBeNull();
    });

    it('nimmt die Ansage nur einmal und nicht vor dem Drücken an', () => {
      const declare: PlayerIntent = { type: 'declare', trump: 'herz', mode: 'play' };
      const declared = play(discarded(), [1, declare]);
      const taken = play(
        started(),
        [2, { type: 'pass' }],
        [0, { type: 'pass' }],
        [1, { type: 'takeDabb' }],
      );

      expect(applyIntent(declared, 1, declare)).toEqual({ ok: false, code: 'WRONG_PHASE' });
      expect(applyIntent(taken, 1, declare)).toEqual({ ok: false, code: 'WRONG_PHASE' });
      expect(applyIntent(started(), 2, declare)).toEqual({ ok: false, code: 'WRONG_PHASE' });
    });

    it('nimmt in der Ansage keine Dabb-Züge mehr an', () => {
      expect(applyIntent(discarded(), 1, { type: 'takeDabb' })).toEqual({
        ok: false,
        code: 'WRONG_PHASE',
      });
    });
  });

  describe('Melden', () => {
    /** Sitz 1 ist Spielmacher, hat gedrückt und Herz angesagt (Version 6). */
    const declared = (mode: DeclareMode) => {
      const taken = play(
        started(),
        [2, { type: 'pass' }],
        [0, { type: 'pass' }],
        [1, { type: 'takeDabb' }],
      );
      return play(
        taken,
        [1, { type: 'discardToDabb', cardIds: taken.round!.hands[1].slice(0, 4).map((c) => c.id) }],
        [1, { type: 'declare', trump: 'herz', mode }],
      );
    };
    const pass = (seat: number): [Actor, Intent] => [seat, { type: 'submitMelds', meldIds: [] }];

    it('lässt ab dem Spielmacher reihum melden und wechselt danach ins Stichspiel', () => {
      const first = play(declared('play'), pass(1));
      expect(first).toMatchObject({ version: 7, phase: 'meld' });
      expect(first.round!.melds).toEqual([null, { melds: [], points: 0 }, null]);

      const offered = legalIntents(play(first, pass(2)), 0)[0];
      expect(offered.type).toBe('submitMelds');
      if (offered.type !== 'submitMelds') return;
      const result = applyIntent(deepFreeze(play(first, pass(2))), 0, {
        type: 'submitMelds',
        meldIds: offered.melds.map((meld) => meld.id),
      });

      expect(result).toMatchObject({
        ok: true,
        state: { version: 9, phase: 'trick' },
        events: [{ type: 'meldsSubmitted', seat: 0, melds: offered.melds }],
      });
    });

    it('lässt beim Abgehen nur die Gegner melden und geht dann in die Abrechnung', () => {
      const state = play(declared('abgehen'), pass(2), pass(0));

      expect(state).toMatchObject({ version: 8, phase: 'score' });
      expect(state.round!.melds).toEqual([
        { melds: [], points: 0 },
        null,
        { melds: [], points: 0 },
      ]);
      // Spielmacher −150 (Reizwert), Gegner 0 Meldepunkte + 3 · 10.
      expect(state.round!.result?.outcome).toBe('abgehen');
      expect(state.scores).toEqual([30, -150, 30]);
    });

    it('meldet mit dem Abschluss beim Abgehen auch die Wertung', () => {
      const result = applyIntent(play(declared('abgehen'), pass(2)), 0, pass(0)[1]);

      expect(result.ok && result.events).toEqual([
        { type: 'meldsSubmitted', seat: 0, melds: [], points: 0 },
        { type: 'roundScored', outcome: 'abgehen' },
      ]);
    });

    it('lässt den Zustand bei Regelverstößen unverändert', () => {
      const state = deepFreeze(declared('play'));

      expect(applyIntent(state, 0, { type: 'submitMelds', meldIds: [] })).toEqual({
        ok: false,
        code: 'NOT_YOUR_TURN',
      });
      expect(applyIntent(state, 1, { type: 'submitMelds', meldIds: ['gibt-es-nicht'] })).toEqual({
        ok: false,
        code: 'MELD_NOT_OFFERED',
      });
      expect(state.version).toBe(6);
    });

    it('nimmt Meldungen nur in der Meldephase an', () => {
      expect(applyIntent(started(), 2, { type: 'submitMelds', meldIds: [] })).toEqual({
        ok: false,
        code: 'WRONG_PHASE',
      });
      expect(applyIntent(play(declared('play'), pass(1), pass(2), pass(0)), 1, pass(1)[1])).toEqual(
        { ok: false, code: 'WRONG_PHASE' },
      );
    });
  });

  describe('Spielende', () => {
    /** Sitz 1 geht mit 150 ab; Sitz 2 und Sitz 0 melden nichts und bekommen je 30. */
    const abgehenWith = (scores: number[]) => {
      const taken = play(
        started(),
        [2, { type: 'pass' }],
        [0, { type: 'pass' }],
        [1, { type: 'takeDabb' }],
      );
      const declared = play(
        taken,
        [1, { type: 'discardToDabb', cardIds: taken.round!.hands[1].slice(0, 4).map((c) => c.id) }],
        [1, { type: 'declare', trump: 'herz', mode: 'abgehen' }],
        [2, { type: 'submitMelds', meldIds: [] }],
      );
      return applyIntent(deepFreeze({ ...declared, scores }), 0, {
        type: 'submitMelds',
        meldIds: [],
      });
    };

    it('endet, sobald eine Partei allein vorn mindestens 1000 Punkte hat', () => {
      const result = abgehenWith([980, 400, 900]);

      expect(result).toMatchObject({
        ok: true,
        state: { phase: 'terminated', scores: [1010, 250, 930], winners: [0], abortReason: null },
        events: [
          { type: 'meldsSubmitted', seat: 0 },
          { type: 'roundScored', outcome: 'abgehen' },
          { type: 'gameFinished', winners: [0] },
        ],
      });
      // Die Wertung der letzten Runde bleibt sichtbar.
      expect(result.ok && result.state.round!.result?.outcome).toBe('abgehen');
    });

    it('spielt bei geteilter Spitze über 1000 weiter', () => {
      const result = abgehenWith([980, 400, 980]);

      expect(result).toMatchObject({
        ok: true,
        state: { phase: 'score', scores: [1010, 250, 1010], winners: null },
      });
      expect(result.ok && result.events.map((event) => event.type)).toEqual([
        'meldsSubmitted',
        'roundScored',
      ]);
    });

    it('nimmt nach dem Spielende keine Züge mehr an', () => {
      const result = abgehenWith([980, 400, 900]);
      if (!result.ok) throw new Error(result.code);

      expect(applyIntent(result.state, 0, { type: 'readyForNextRound' })).toEqual({
        ok: false,
        code: 'WRONG_PHASE',
      });
      expect(
        applyIntent(result.state, SYSTEM, { type: 'abortGame', reason: 'PLAYER_LEFT' }),
      ).toEqual({ ok: false, code: 'WRONG_PHASE' });
    });
  });

  describe('Stichspiel', () => {
    /** Sitz 1 ist Spielmacher mit Herz-Trumpf, alle haben ohne Meldung durchgewunken. */
    const inTricks = () => {
      const taken = play(
        started(),
        [2, { type: 'pass' }],
        [0, { type: 'pass' }],
        [1, { type: 'takeDabb' }],
      );
      return play(
        taken,
        [1, { type: 'discardToDabb', cardIds: taken.round!.hands[1].slice(0, 4).map((c) => c.id) }],
        [1, { type: 'declare', trump: 'herz', mode: 'play' }],
        [1, { type: 'submitMelds', meldIds: [] }],
        [2, { type: 'submitMelds', meldIds: [] }],
        [0, { type: 'submitMelds', meldIds: [] }],
      );
    };
    /** Der Sitz am Zug legt die erste erlaubte Karte. */
    const firstLegal = (state: GameState): [Actor, Intent] => {
      const seat = [0, 1, 2].find((other) => legalIntents(state, other).length > 0)!;
      const [offer] = legalIntents(state, seat);
      if (offer.type !== 'playCard') throw new Error(`Unerwartetes Angebot ${offer.type}`);
      return [seat, { type: 'playCard', cardId: offer.cardIds[0] }];
    };

    it('lässt die Vorhand ausspielen und meldet jede gelegte Karte', () => {
      const state = deepFreeze(inTricks());
      expect(state).toMatchObject({ version: 9, phase: 'trick' });

      const [seat, intent] = firstLegal(state);
      expect(seat).toBe(1);
      const result = applyIntent(state, seat, intent);

      expect(result).toMatchObject({
        ok: true,
        state: { version: 10, phase: 'trick' },
        events: [{ type: 'cardPlayed', seat: 1 }],
      });
    });

    it('spielt alle Stiche und wechselt danach in die Abrechnung', () => {
      let state = inTricks();
      const events: string[] = [];
      while (state.phase === 'trick') {
        const result = applyIntent(deepFreeze(state), ...firstLegal(state));
        if (!result.ok) throw new Error(result.code);
        events.push(...result.events.map((event) => event.type));
        state = result.state;
      }

      expect(state).toMatchObject({ version: 9 + 36, phase: 'score' });
      expect(state.round!.tricks).toHaveLength(12);
      expect(state.round!.hands.flat()).toEqual([]);
      expect(events.filter((type) => type === 'trickWon')).toHaveLength(12);
      // Die letzte Karte schließt den Stich und die Runde ab.
      expect(events.slice(-3)).toEqual(['cardPlayed', 'trickWon', 'roundScored']);
    });

    it('wertet die Runde nach dem letzten Stich und schreibt die Punktestände fort', () => {
      let state = inTricks();
      while (state.phase === 'trick') state = play(state, firstLegal(state));
      const { result } = state.round!;

      expect(result).toEqual(scoreRound(state.round!, state.config));
      expect(state.scores).toEqual(result!.parties.map((party) => party.delta));
    });

    it('lässt den Zustand bei Regelverstößen unverändert', () => {
      const state = deepFreeze(inTricks());
      const foreign = state.round!.hands[2][0].id;

      expect(applyIntent(state, 2, { type: 'playCard', cardId: foreign })).toEqual({
        ok: false,
        code: 'NOT_YOUR_TURN',
      });
      expect(applyIntent(state, 1, { type: 'playCard', cardId: foreign })).toEqual({
        ok: false,
        code: 'CARD_NOT_IN_HAND',
      });
      expect(state.version).toBe(9);
    });

    it('nimmt Karten nur im Stichspiel an', () => {
      const card = started().round!.hands[2][0].id;
      expect(applyIntent(started(), 2, { type: 'playCard', cardId: card })).toEqual({
        ok: false,
        code: 'WRONG_PHASE',
      });
    });
  });

  describe('Züge der übrigen Phasen', () => {
    const later: PlayerIntent[] = [{ type: 'readyForNextRound' }];

    it.each(later)('lehnt $type ab, bis die Regeln umgesetzt sind', (intent) => {
      const bidding = deepFreeze(started());
      const decided = deepFreeze(play(started(), [2, { type: 'pass' }], [0, { type: 'pass' }]));

      expect(applyIntent(bidding, 2, intent)).toEqual({ ok: false, code: 'WRONG_PHASE' });
      expect(decided.phase).toBe('dabb');
      expect(applyIntent(decided, 1, intent)).toEqual({ ok: false, code: 'WRONG_PHASE' });
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
