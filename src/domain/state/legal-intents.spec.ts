import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildDeck } from '../cards/deck';
import {
  NO_SPECIAL_RULES,
  type DeckSize,
  type GameConfig,
  type PlayerCount,
} from '../config/game-config';
import type { Seat } from '../rules/parties';
import { applyIntent } from './apply-intent';
import { BID_STEP, MAX_BID, OPENING_BID } from './bidding';
import { activeSeat, createGame, type GameState } from './game-state';
import { concretize, seededRandom } from '../../test/random-bot';
import { SYSTEM, type IntentResult } from './intents';
import { legalIntents } from './legal-intents';
import { bestMelds } from '../melds/best-melds';

const configFor = (playerCount: PlayerCount, deckSize: DeckSize): GameConfig => ({
  playerCount,
  deckSize,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
});

function started(config: GameConfig, dealer: Seat): GameState {
  const result = applyIntent(createGame(config, dealer), SYSTEM, {
    type: 'startRound',
    shuffledDeck: buildDeck(config.deckSize),
  });
  if (!result.ok) throw new Error(`Unerwarteter Fehler ${result.code}`);
  return result.state;
}

function ok(result: IntentResult): GameState {
  if (!result.ok) throw new Error(`Unerwarteter Fehler ${result.code}`);
  return result.state;
}

function seatsOf(state: GameState): Seat[] {
  return Array.from({ length: state.config.playerCount }, (_, seat) => seat);
}

describe('legalIntents', () => {
  const config = configFor(3, 40);

  it('bietet vor der ersten Runde nichts an', () => {
    const state = createGame(config, 0);

    expect(seatsOf(state).map((seat) => legalIntents(state, seat))).toEqual([[], [], []]);
  });

  it('bietet dem Sitz am Zug Gebot mit Spielraum und Passen an', () => {
    // Geber 0, Vorhand 1 hält 150, Sitz 2 ist am Zug.
    const state = started(config, 0);

    expect(legalIntents(state, 2)).toEqual([
      { type: 'bid', min: OPENING_BID + BID_STEP, max: MAX_BID, step: BID_STEP },
      { type: 'pass' },
    ]);
    expect(legalIntents(state, 0)).toEqual([]);
    expect(legalIntents(state, 1)).toEqual([]);
  });

  it('bietet nach dem Reizen nur dem Spielmacher erst das Aufnehmen, dann das Drücken an', () => {
    // Sitz 2 bietet 1000 und wird damit sofort Spielmacher.
    const decided = ok(applyIntent(started(config, 0), 2, { type: 'bid', amount: MAX_BID }));
    expect(seatsOf(decided).map((seat) => legalIntents(decided, seat))).toEqual([
      [],
      [],
      [{ type: 'takeDabb' }],
    ]);

    const taken = ok(applyIntent(decided, 2, { type: 'takeDabb' }));
    expect(seatsOf(taken).map((seat) => legalIntents(taken, seat))).toEqual([
      [],
      [],
      [{ type: 'discardToDabb', count: 4 }],
    ]);

    // Bei 3 Spielern und 48 Karten hat der Dabb nur 3 Karten.
    const small = ok(
      applyIntent(started(configFor(3, 48), 0), 2, { type: 'bid', amount: MAX_BID }),
    );
    expect(legalIntents(ok(applyIntent(small, 2, { type: 'takeDabb' })), 2)).toEqual([
      { type: 'discardToDabb', count: 3 },
    ]);
  });

  /** Sitz 2 bietet 1000, nimmt auf und drückt; danach steht die Ansage an. */
  function discarded(): GameState {
    const decided = ok(applyIntent(started(config, 0), 2, { type: 'bid', amount: MAX_BID }));
    const taken = ok(applyIntent(decided, 2, { type: 'takeDabb' }));
    return ok(
      applyIntent(taken, 2, {
        type: 'discardToDabb',
        cardIds: taken.round!.hands[2].slice(0, 4).map((card) => card.id),
      }),
    );
  }

  it('bietet nach dem Drücken nur dem Spielmacher die Ansage mit beiden Spielarten an', () => {
    const state = discarded();

    expect(seatsOf(state).map((seat) => legalIntents(state, seat))).toEqual([
      [],
      [],
      [{ type: 'declare', modes: ['play', 'abgehen'] }],
    ]);
  });

  it.each([
    ['play', [2, 0, 1], 'trick'],
    ['abgehen', [0, 1], 'score'],
  ] as const)(
    'bietet nach der Ansage (%s) den Meldeberechtigten der Reihe nach ihren Vorschlag an',
    (mode, order, after) => {
      let state = ok(applyIntent(discarded(), 2, { type: 'declare', trump: 'gruen', mode }));

      for (const seat of order) {
        expect(seatsOf(state).map((other) => legalIntents(state, other).length)).toEqual(
          seatsOf(state).map((other) => (other === seat ? 1 : 0)),
        );
        expect(legalIntents(state, seat)).toEqual([
          { type: 'submitMelds', melds: bestMelds(state.round!.hands[seat], 'gruen', 40) },
        ]);
        state = ok(applyIntent(state, seat, { type: 'submitMelds', meldIds: [] }));
      }

      expect(state.phase).toBe(after);
      // Im Stichspiel spielt die Vorhand (Sitz 1) aus, nach dem Abgehen bestätigen alle die
      // nächste Runde.
      const offered = seatsOf(state).filter((seat) => legalIntents(state, seat).length > 0);
      expect(offered).toEqual(mode === 'play' ? [1] : [0, 1, 2]);
    },
  );

  it('bietet nach einem Abbruch nichts mehr an', () => {
    const aborted = ok(
      applyIntent(started(config, 0), SYSTEM, { type: 'abortGame', reason: 'PLAYER_LEFT' }),
    );

    expect(seatsOf(aborted).flatMap((seat) => legalIntents(aborted, seat))).toEqual([]);
  });

  describe('Übereinstimmung mit applyIntent', () => {
    const configs = fc.constantFrom(
      configFor(3, 40),
      configFor(3, 48),
      configFor(4, 40),
      configFor(4, 48),
    );
    // Je Zug: Welcher der angebotenen Züge, und ein Seed für die Wahl in seinem Spielraum.
    const picks = fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 120 });

    it('nimmt jeden angebotenen Zug an und lehnt Züge ohne Angebot ab', () => {
      fc.assert(
        fc.property(configs, fc.nat(3), picks, (anyConfig, rawDealer, list) => {
          let state = started(anyConfig, rawDealer % anyConfig.playerCount);

          // Am Ende passen alle, damit das Reizen sicher entschieden wird; danach bleiben je
          // ein Zug für Aufnehmen, Drücken und Ansage, bis zu n Meldungen und höchstens 48 Karten.
          const passes = Array.from(
            { length: 2 * anyConfig.playerCount + 51 },
            (): [number, number] => [1, 0],
          );
          for (const [which, value] of [...list, ...passes]) {
            // In der Abrechnung handeln alle unabhängig; das prüft ein eigener Test.
            if (state.phase === 'score') break;
            const offers = seatsOf(state).map((seat) => legalIntents(state, seat));
            const active = offers.findIndex((offer) => offer.length > 0);
            if (active === -1) break;

            // Genau ein Sitz ist am Zug, alle anderen dürfen denselben Zug nicht ausführen.
            expect(offers.filter((offer) => offer.length > 0)).toHaveLength(1);
            expect(activeSeat(state)).toBe(active);
            const offer = offers[active];
            const intent = concretize(
              offer[which % offer.length],
              state.round!.hands[active],
              seededRandom(value),
            );
            for (const seat of seatsOf(state).filter((other) => other !== active)) {
              expect(applyIntent(state, seat, intent).ok).toBe(false);
            }

            const result = applyIntent(state, active, intent);
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.state.version).toBe(state.version + 1);
            state = result.state;
          }

          // Kein Deadlock: Die Runde erreicht immer die Abrechnung, nach dem letzten Stich oder
          // direkt nach dem Abgehen. Dort ist niemand allein am Zug.
          expect(state.round?.dabbStatus).toBe('discarded');
          expect(state.phase).toBe('score');
          expect(activeSeat(state)).toBeNull();
        }),
      );
    });

    it('lehnt Gebote außerhalb des angebotenen Spielraums ab', () => {
      fc.assert(
        fc.property(configs, fc.integer({ min: -50, max: 1200 }), (anyConfig, amount) => {
          const state = started(anyConfig, 0);
          const active = seatsOf(state).find((seat) => legalIntents(state, seat).length > 0)!;
          const offer = legalIntents(state, active).find((legal) => legal.type === 'bid')!;
          const offered =
            amount >= offer.min && amount <= offer.max && (amount - offer.min) % offer.step === 0;

          expect(applyIntent(state, active, { type: 'bid', amount }).ok).toBe(offered);
        }),
      );
    });
  });
});
