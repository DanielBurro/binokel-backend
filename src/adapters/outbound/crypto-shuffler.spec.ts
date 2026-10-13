import { describe, expect, it } from 'vitest';
import { createCryptoShuffler } from './crypto-shuffler';

describe('createCryptoShuffler', () => {
  it('liefert eine Permutation, ohne die Eingabe zu verändern', () => {
    const input = Array.from({ length: 48 }, (_, index) => index);
    const frozen = [...input];

    const result = createCryptoShuffler().shuffle(input);

    expect(input).toEqual(frozen);
    expect(result).not.toBe(input);
    expect([...result].sort((a, b) => a - b)).toEqual(frozen);
  });

  it('wendet Fisher-Yates mit den oberen Grenzen n, n-1, … an', () => {
    const bounds: number[] = [];
    const shuffler = createCryptoShuffler((max) => {
      bounds.push(max);
      return 0;
    });

    expect(shuffler.shuffle([1, 2, 3, 4])).toEqual([2, 3, 4, 1]);
    expect(bounds).toEqual([4, 3, 2]);
  });

  it('verarbeitet leere und einelementige Eingaben', () => {
    const shuffler = createCryptoShuffler();
    expect(shuffler.shuffle([])).toEqual([]);
    expect(shuffler.shuffle([7])).toEqual([7]);
  });
});
