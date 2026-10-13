import { describe, expect, it } from 'vitest';
import { NO_SPECIAL_RULES, validateGameConfig, type GameConfig } from './game-config';

const base: GameConfig = {
  playerCount: 3,
  deckSize: 48,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
};

function withRules(
  overrides: Partial<GameConfig['specialRules']>,
  config: Partial<GameConfig> = {},
): GameConfig {
  return { ...base, ...config, specialRules: { ...NO_SPECIAL_RULES, ...overrides } };
}

describe('validateGameConfig', () => {
  it('akzeptiert die Grundkonfiguration ohne Sonderregeln', () => {
    expect(validateGameConfig(base)).toEqual({ ok: true, config: base });
  });

  it('erlaubt Tauschen nur mit vier Spielern', () => {
    expect(validateGameConfig(withRules({ tauschen: true }, { playerCount: 4 })).ok).toBe(true);
    expect(validateGameConfig(withRules({ tauschen: true }))).toEqual({
      ok: false,
      errors: ['TAUSCHEN_REQUIRES_FOUR_PLAYERS'],
    });
  });

  it('erlaubt Kein Dabb nur, wenn sich alle Karten gleichmäßig verteilen lassen', () => {
    const keinDabb = { keinDabb: true };
    expect(validateGameConfig(withRules(keinDabb, { playerCount: 3, deckSize: 48 })).ok).toBe(true);
    expect(validateGameConfig(withRules(keinDabb, { playerCount: 4, deckSize: 40 })).ok).toBe(true);
    expect(validateGameConfig(withRules(keinDabb, { playerCount: 3, deckSize: 40 }))).toEqual({
      ok: false,
      errors: ['KEIN_DABB_NOT_DIVISIBLE'],
    });
  });

  it('sammelt mehrere Fehler', () => {
    const result = validateGameConfig(
      withRules({ tauschen: true, keinDabb: true }, { playerCount: 3, deckSize: 40 }),
    );
    expect(result).toEqual({
      ok: false,
      errors: ['TAUSCHEN_REQUIRES_FOUR_PLAYERS', 'KEIN_DABB_NOT_DIVISIBLE'],
    });
  });
});
