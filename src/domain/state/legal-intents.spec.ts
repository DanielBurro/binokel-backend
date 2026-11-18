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
import { createGame, type GameState } from './game-state';
import { SYSTEM, type LegalIntent, type PlayerIntent } from './intents';
import { legalIntents } from './legal-intents';

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

function seatsOf(state: GameState): Seat[] {
  return Array.from({ length: state.config.playerCount }, (_, seat) => seat);
}

/** Macht aus einem angebotenen Zug einen konkreten; `pick` wählt innerhalb des Spielraums. */
function concretize(legal: LegalIntent, pick: number): PlayerIntent {
  switch (legal.type) {
    case 'bid': {
      const choices = (legal.max - legal.min) / legal.step + 1;
      return { type: 'bid', amount: legal.min + (pick % choices) * legal.step };
    }
    case 'pass':
      return { type: 'pass' };
    default:
      throw new Error(`Zug ${legal.type} wird noch nicht angeboten`);
  }
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

  it('bietet nach dem Reizen und nach einem Abbruch nichts mehr an', () => {
    const maxBid = applyIntent(started(config, 0), 2, { type: 'bid', amount: MAX_BID });
    const aborted = applyIntent(started(config, 0), SYSTEM, {
      type: 'abortGame',
      reason: 'PLAYER_LEFT',
    });

    for (const result of [maxBid, aborted]) {
      if (!result.ok) throw new Error(`Unerwarteter Fehler ${result.code}`);
      expect(seatsOf(result.state).flatMap((seat) => legalIntents(result.state, seat))).toEqual([]);
    }
  });

  describe('Übereinstimmung mit applyIntent', () => {
    const configs = fc.constantFrom(
      configFor(3, 40),
      configFor(3, 48),
      configFor(4, 40),
      configFor(4, 48),
    );
    // Je Zug: Welcher der angebotenen Züge, und welcher Wert aus seinem Spielraum.
    const picks = fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 120 });

    it('nimmt jeden angebotenen Zug an und lehnt Züge ohne Angebot ab', () => {
      fc.assert(
        fc.property(configs, fc.nat(3), picks, (anyConfig, rawDealer, list) => {
          let state = started(anyConfig, rawDealer % anyConfig.playerCount);

          // Am Ende passen alle, damit das Reizen sicher entschieden wird.
          const passes = Array.from({ length: anyConfig.playerCount }, (): [number, number] => [
            1, 0,
          ]);
          for (const [which, value] of [...list, ...passes]) {
            const offers = seatsOf(state).map((seat) => legalIntents(state, seat));
            const active = offers.findIndex((offer) => offer.length > 0);
            if (active === -1) break;

            // Genau ein Sitz ist am Zug, alle anderen dürfen nichts.
            expect(offers.filter((offer) => offer.length > 0)).toHaveLength(1);
            for (const seat of seatsOf(state).filter((other) => other !== active)) {
              expect(applyIntent(state, seat, { type: 'pass' }).ok).toBe(false);
            }

            const offer = offers[active];
            const result = applyIntent(
              state,
              active,
              concretize(offer[which % offer.length], value),
            );
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.state.version).toBe(state.version + 1);
            state = result.state;
          }

          // Kein Deadlock: Bietet niemand mehr etwas an, ist das Reizen entschieden.
          expect(state.phase).toBe('dabb');
          expect(state.round?.declarer).not.toBeNull();
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
