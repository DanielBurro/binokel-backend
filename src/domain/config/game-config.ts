export type PlayerCount = 3 | 4;
export type DeckSize = 40 | 48;
export const GAME_MODES = ['classic', 'league'] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** Die Flags sind Teil des Typs; ihr Verhalten kommt mit den jeweiligen Regelerweiterungen. */
export interface SpecialRules {
  readonly halbeStrafe: boolean;
  readonly trumpfStichzwang: boolean;
  readonly durch: boolean;
  readonly untendurch: boolean;
  readonly rufen: boolean;
  readonly keinDabb: boolean;
  readonly tauschen: boolean;
}

export type SpecialRule = keyof SpecialRules;

export interface GameConfig {
  readonly playerCount: PlayerCount;
  readonly deckSize: DeckSize;
  readonly specialRules: SpecialRules;
  readonly mode: GameMode;
}

export const NO_SPECIAL_RULES: SpecialRules = {
  halbeStrafe: false,
  trumpfStichzwang: false,
  durch: false,
  untendurch: false,
  rufen: false,
  keinDabb: false,
  tauschen: false,
};

/** Sonderregeln, deren Verhalten die Engine umsetzt; wächst mit Phase H. */
export const SUPPORTED_SPECIAL_RULES: ReadonlySet<SpecialRule> = new Set<SpecialRule>();
/** 'league' kommt mit Schritt 37 hinzu. */
export const SUPPORTED_MODES: ReadonlySet<GameMode> = new Set<GameMode>(['classic']);

export interface EngineSupport {
  readonly specialRules: ReadonlySet<SpecialRule>;
  readonly modes: ReadonlySet<GameMode>;
}

const ENGINE_SUPPORT: EngineSupport = {
  specialRules: SUPPORTED_SPECIAL_RULES,
  modes: SUPPORTED_MODES,
};

export type GameConfigError =
  | 'TAUSCHEN_REQUIRES_FOUR_PLAYERS'
  | 'KEIN_DABB_NOT_DIVISIBLE'
  | 'SPECIAL_RULE_NOT_SUPPORTED'
  | 'MODE_NOT_SUPPORTED';

export type GameConfigValidation =
  | { readonly ok: true; readonly config: GameConfig }
  | { readonly ok: false; readonly errors: readonly GameConfigError[] };

export function validateGameConfig(
  config: GameConfig,
  support: EngineSupport = ENGINE_SUPPORT,
): GameConfigValidation {
  const { playerCount, deckSize, specialRules, mode } = config;
  const errors: GameConfigError[] = [];

  if (specialRules.tauschen && playerCount !== 4) {
    errors.push('TAUSCHEN_REQUIRES_FOUR_PLAYERS');
  }
  // Ohne Dabb müssen sich alle Karten gleichmäßig verteilen lassen.
  if (specialRules.keinDabb && playerCount !== 4 && deckSize !== 48) {
    errors.push('KEIN_DABB_NOT_DIVISIBLE');
  }
  // Sonst bekäme ein Client mit gesetztem Flag oder Modus ohne Hinweis ein klassisches Spiel.
  const requested = (Object.keys(NO_SPECIAL_RULES) as SpecialRule[]).filter(
    (rule) => specialRules[rule],
  );
  if (requested.some((rule) => !support.specialRules.has(rule))) {
    errors.push('SPECIAL_RULE_NOT_SUPPORTED');
  }
  if (!support.modes.has(mode)) {
    errors.push('MODE_NOT_SUPPORTED');
  }

  return errors.length === 0 ? { ok: true, config } : { ok: false, errors };
}
