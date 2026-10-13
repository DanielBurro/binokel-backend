import { randomInt } from 'node:crypto';
import type { ShufflerPort } from '../../application/ports/outbound/shuffler.port';

/** Fisher-Yates mit kryptografischem Zufall (FA-04). */
export function createCryptoShuffler(
  nextInt: (maxExclusive: number) => number = (max) => randomInt(max),
): ShufflerPort {
  return {
    shuffle<T>(items: readonly T[]): T[] {
      const result = [...items];
      for (let i = result.length - 1; i > 0; i--) {
        const j = nextInt(i + 1);
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    },
  };
}
