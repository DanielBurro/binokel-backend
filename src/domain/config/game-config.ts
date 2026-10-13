export type PlayerCount = 3 | 4;
export type DeckSize = 40 | 48;
export type GameMode = 'classic' | 'league';

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

export type GameConfigError = 'TAUSCHEN_REQUIRES_FOUR_PLAYERS' | 'KEIN_DABB_NOT_DIVISIBLE';

export type GameConfigValidation =
  | { readonly ok: true; readonly config: GameConfig }
  | { readonly ok: false; readonly errors: readonly GameConfigError[] };

export function validateGameConfig(config: GameConfig): GameConfigValidation {
  const { playerCount, deckSize, specialRules } = config;
  const errors: GameConfigError[] = [];

  if (specialRules.tauschen && playerCount !== 4) {
    errors.push('TAUSCHEN_REQUIRES_FOUR_PLAYERS');
  }
  // Ohne Dabb müssen sich alle Karten gleichmäßig verteilen lassen.
  if (specialRules.keinDabb && playerCount !== 4 && deckSize !== 48) {
    errors.push('KEIN_DABB_NOT_DIVISIBLE');
  }

  return errors.length === 0 ? { ok: true, config } : { ok: false, errors };
}
