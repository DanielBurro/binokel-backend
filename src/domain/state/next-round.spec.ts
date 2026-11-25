import { describe, expect, it } from 'vitest';
import { buildDeck } from '../cards/deck';
import { NO_SPECIAL_RULES, type GameConfig } from '../config/game-config';
import { applyIntent } from './apply-intent';
import { createGame, type GameState, type Phase } from './game-state';
import { SYSTEM } from './intents';
import { everyoneReady, markReady } from './next-round';

const config: GameConfig = {
  playerCount: 3,
  deckSize: 40,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
};

function started(): GameState {
  const result = applyIntent(createGame(config, 0), SYSTEM, {
    type: 'startRound',
    shuffledDeck: buildDeck(40),
  });
  if (!result.ok) throw new Error(result.code);
  return result.state;
}

describe('markReady', () => {
  it('merkt sich die Bestätigung in Reihenfolge und meldet sie', () => {
    const { round } = started();
    const first = markReady(round!, 2);

    expect(first).toEqual({
      ok: true,
      round: { ...round, ready: [2] },
      events: [{ type: 'playerReady', seat: 2 }],
    });
    if (!first.ok) return;
    expect(markReady(first.round, 0)).toMatchObject({ ok: true, round: { ready: [2, 0] } });
  });

  it('nimmt jede Bestätigung nur einmal an', () => {
    const { round } = started();
    expect(markReady({ ...round!, ready: [1] }, 1)).toEqual({ ok: false, code: 'ALREADY_READY' });
  });
});

describe('everyoneReady', () => {
  const withReady = (phase: Phase, ready: number[]): GameState => {
    const state = started();
    return { ...state, phase, round: { ...state.round!, ready } };
  };

  it('gilt erst, wenn in der Abrechnung alle bestätigt haben', () => {
    expect(everyoneReady(withReady('score', [0, 1]))).toBe(false);
    expect(everyoneReady(withReady('score', [0, 2, 1]))).toBe(true);
    expect(everyoneReady(withReady('trick', [0, 2, 1]))).toBe(false);
    expect(everyoneReady(createGame(config, 0))).toBe(false);
  });
});
