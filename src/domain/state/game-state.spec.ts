import { describe, expect, it } from 'vitest';
import { NO_SPECIAL_RULES, type GameConfig } from '../config/game-config';
import { createGame, nextPhase, type Phase } from './game-state';

const config = (playerCount: 3 | 4): GameConfig => ({
  playerCount,
  deckSize: 48,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
});

describe('createGame', () => {
  it('legt ein Spiel ohne Runde mit Version 0 und Nullständen je Partei an', () => {
    const state = createGame(config(3), 2);

    expect(state).toMatchObject({ version: 0, phase: 'created', dealer: 2, round: null });
    expect(state.scores).toEqual([0, 0, 0]);
    expect(createGame(config(4), 0).scores).toEqual([0, 0]);
  });

  it('weist ungültige Geber ab', () => {
    expect(() => createGame(config(3), 3)).toThrow(RangeError);
  });
});

describe('nextPhase', () => {
  const withPhase = (phase: Phase) => ({ ...createGame(config(3), 0), phase });

  it('folgt der klassischen Phasenfolge', () => {
    expect(nextPhase(withPhase('bidding'))).toBe('dabb');
    expect(nextPhase(withPhase('dabb'))).toBe('declare');
    expect(nextPhase(withPhase('declare'))).toBe('meld');
    expect(nextPhase(withPhase('meld'))).toBe('trick');
    expect(nextPhase(withPhase('trick'))).toBe('score');
  });

  it.each<Phase>(['created', 'score', 'terminated'])('kennt keine Folgephase für %s', (phase) => {
    expect(() => nextPhase(withPhase(phase))).toThrow();
  });
});
