import { describe, expect, it } from 'vitest';
import {
  NO_SPECIAL_RULES,
  SUPPORTED_MODES,
  SUPPORTED_SPECIAL_RULES,
  validateGameConfig,
  type EngineSupport,
  type GameConfig,
  type GameMode,
  type SpecialRule,
} from './game-config';

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

/** Prüft die strukturellen Regeln so, als wären alle Sonderregeln und Modi schon umgesetzt. */
const fullSupport: EngineSupport = {
  specialRules: new Set(Object.keys(NO_SPECIAL_RULES) as SpecialRule[]),
  modes: new Set<GameMode>(['classic', 'league']),
};
const validate = (config: GameConfig) => validateGameConfig(config, fullSupport);

describe('validateGameConfig', () => {
  it('akzeptiert die Grundkonfiguration ohne Sonderregeln', () => {
    expect(validateGameConfig(base)).toEqual({ ok: true, config: base });
  });

  it.each(Object.keys(NO_SPECIAL_RULES) as SpecialRule[])(
    'lehnt die noch nicht umgesetzte Sonderregel %s ab',
    (rule) => {
      expect(SUPPORTED_SPECIAL_RULES.has(rule)).toBe(false);
      expect(validateGameConfig(withRules({ [rule]: true }, { playerCount: 4 }))).toEqual({
        ok: false,
        errors: ['SPECIAL_RULE_NOT_SUPPORTED'],
      });
    },
  );

  it('akzeptiert unterstützte Sonderregeln', () => {
    const config = withRules({ halbeStrafe: true });
    expect(
      validateGameConfig(config, {
        specialRules: new Set(['halbeStrafe']),
        modes: SUPPORTED_MODES,
      }),
    ).toEqual({ ok: true, config });
  });

  it('lehnt den noch nicht umgesetzten Liga-Modus ab', () => {
    expect(SUPPORTED_MODES.has('league')).toBe(false);
    expect(validateGameConfig({ ...base, mode: 'league' })).toEqual({
      ok: false,
      errors: ['MODE_NOT_SUPPORTED'],
    });
    expect(validate({ ...base, mode: 'league' }).ok).toBe(true);
  });

  it('erlaubt Tauschen nur mit vier Spielern', () => {
    expect(validate(withRules({ tauschen: true }, { playerCount: 4 })).ok).toBe(true);
    expect(validate(withRules({ tauschen: true }))).toEqual({
      ok: false,
      errors: ['TAUSCHEN_REQUIRES_FOUR_PLAYERS'],
    });
  });

  it('erlaubt Kein Dabb nur, wenn sich alle Karten gleichmäßig verteilen lassen', () => {
    const keinDabb = { keinDabb: true };
    expect(validate(withRules(keinDabb, { playerCount: 3, deckSize: 48 })).ok).toBe(true);
    expect(validate(withRules(keinDabb, { playerCount: 4, deckSize: 40 })).ok).toBe(true);
    expect(validate(withRules(keinDabb, { playerCount: 3, deckSize: 40 }))).toEqual({
      ok: false,
      errors: ['KEIN_DABB_NOT_DIVISIBLE'],
    });
  });

  it('sammelt mehrere Fehler', () => {
    const result = validate(
      withRules({ tauschen: true, keinDabb: true }, { playerCount: 3, deckSize: 40 }),
    );
    expect(result).toEqual({
      ok: false,
      errors: ['TAUSCHEN_REQUIRES_FOUR_PLAYERS', 'KEIN_DABB_NOT_DIVISIBLE'],
    });
  });
});
