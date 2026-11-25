import { describe, expect, it } from 'vitest';
import { winningParty } from './game-end';

describe('winningParty', () => {
  it.each<[string, number[], number | null]>([
    ['niemand erreicht 1000', [990, 600, -200], null],
    ['genau 1000', [1000, 400, 300], 0],
    ['mehrere über 1000, höchste gewinnt', [1010, 1120, 300], 1],
    ['geteilte Spitze: weitere Runde', [1050, 1050, 980], null],
    ['geteilte Spitze unter einem Höheren zählt nicht', [1050, 1050, 1100], 2],
    ['4 Spieler, zwei Parteien', [1040, 870], 0],
    ['negative Stände', [-300, -1000, 20], null],
  ])('%s', (_, scores, winner) => {
    expect(winningParty(scores)).toBe(winner);
  });
});
