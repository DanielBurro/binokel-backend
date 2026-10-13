import type { DeckSize, PlayerCount } from './game-config';

export interface DealStep {
  /** 'players': je Spieler `count` Karten; 'dabb': `count` Karten in den Dabb. */
  readonly target: 'players' | 'dabb';
  readonly count: number;
}

export interface DealConfig {
  readonly playerCount: PlayerCount;
  readonly deckSize: DeckSize;
}

/** Zählt abwechselnd Spieler- und Dabb-Pakete, beginnend mit den Spielern. */
function pattern(...counts: number[]): readonly DealStep[] {
  return counts.map((count, index) => ({
    target: index % 2 === 0 ? 'players' : 'dabb',
    count,
  }));
}

const DEAL_PATTERNS: Readonly<Record<`${PlayerCount}/${DeckSize}`, readonly DealStep[]>> = {
  '3/40': pattern(4, 2, 4, 2, 4),
  '4/40': pattern(3, 2, 3, 2, 3),
  '3/48': pattern(5, 1, 5, 2, 5),
  '4/48': pattern(4, 2, 3, 2, 4),
};

export function dealPattern(config: DealConfig): readonly DealStep[] {
  return DEAL_PATTERNS[`${config.playerCount}/${config.deckSize}`];
}

function sumCounts(config: DealConfig, target: DealStep['target']): number {
  return dealPattern(config)
    .filter((step) => step.target === target)
    .reduce((sum, step) => sum + step.count, 0);
}

export function handSize(config: DealConfig): number {
  return sumCounts(config, 'players');
}

export function dabbSize(config: DealConfig): number {
  return sumCounts(config, 'dabb');
}
