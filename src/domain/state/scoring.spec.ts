import { describe, expect, it } from 'vitest';
import { makeCard, type Rank, type Suit } from '../cards/card';
import { NO_SPECIAL_RULES, type GameConfig, type PlayerCount } from '../config/game-config';
import type { CompletedTrick, DeclareMode, RoundState } from './game-state';
import { roundToTen, scoreRound } from './scoring';

const configFor = (playerCount: PlayerCount): GameConfig => ({
  playerCount,
  deckSize: 40,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
});

const c = (suit: Suit, rank: Rank) => makeCard(suit, rank, 1);
/** Ein Stich mit den angegebenen Karten ab Sitz 0 und dem angegebenen Gewinner. */
const trick = (winner: number, ...cards: ReturnType<typeof c>[]): CompletedTrick => ({
  plays: cards.map((card, seat) => ({ seat, card })),
  winner,
});

// Augen: Eichel 25, Grün 16, Herz 23; gedrückt Schellen-Ass und -Zehn, also 21.
const eichel = (winner: number) =>
  trick(winner, c('eichel', 'ass'), c('eichel', 'zehn'), c('eichel', 'koenig'));
const gruen = (winner: number) =>
  trick(winner, c('gruen', 'ass'), c('gruen', 'unter'), c('gruen', 'ober'));
const herz = (winner: number) =>
  trick(winner, c('herz', 'ass'), c('herz', 'zehn'), c('herz', 'unter'));

interface Setup {
  readonly playerCount?: PlayerCount;
  readonly bid?: number;
  readonly mode?: DeclareMode;
  readonly tricks?: CompletedTrick[];
  /** Gemeldete Punkte je Sitz; null für „nicht gemeldet“. */
  readonly melds?: (number | null)[];
}

/** Spielmacher ist Sitz 1. */
function round({
  playerCount = 3,
  bid = 180,
  mode = 'play',
  tricks = [eichel(1), gruen(0), herz(1)],
  melds = [20, 100, 40],
}: Setup = {}): RoundState {
  return {
    dealer: 0,
    forehand: 1,
    hands: Array.from({ length: playerCount }, () => []),
    dabb: [],
    dabbStatus: 'discarded',
    discarded: [c('schellen', 'ass'), c('schellen', 'zehn')],
    bidding: { highestBid: bid, highestBidder: 1, passed: [], activeSeat: null },
    declarer: 1,
    declaration: { trump: 'herz', mode },
    melds: melds.map((points) => (points === null ? null : { melds: [], points })),
    trick: [],
    tricks,
  };
}

const score = (setup: Setup = {}) => scoreRound(round(setup), configFor(setup.playerCount ?? 3));

describe('roundToTen', () => {
  it.each([
    [0, 0],
    [4, 0],
    [5, 10],
    [44, 40],
    [45, 50],
    [79, 80],
    [250, 250],
  ])('rundet %i auf %i', (value, rounded) => {
    expect(roundToTen(value)).toBe(rounded);
  });
});

describe('scoreRound', () => {
  it('rechnet Augen mit letztem Stich und gedrücktem Dabb und rundet je Partei', () => {
    const { parties } = score();

    // Spielmacher: Eichel 25 + Herz 23 + letzter Stich 10 + Dabb 21 = 79.
    expect(parties.map((party) => [party.eyes, party.trickPoints, party.tricksWon])).toEqual([
      [16, 20, 1],
      [79, 80, 2],
      [0, 0, 0],
    ]);
  });

  it('wertet ein Spiel genau beim Reizwert als erreicht', () => {
    // Spielmacher: 80 Stichpunkte + 100 Meldepunkte = 180 = Reizwert.
    expect(score({ bid: 180 })).toEqual({
      outcome: 'made',
      parties: [
        { eyes: 16, tricksWon: 1, trickPoints: 20, meldPoints: 20, meldsCounted: true, delta: 40 },
        {
          eyes: 79,
          tricksWon: 2,
          trickPoints: 80,
          meldPoints: 100,
          meldsCounted: true,
          delta: 180,
        },
        // Stichklausel: ohne Stich verfallen die 40 Meldepunkte.
        { eyes: 0, tricksWon: 0, trickPoints: 0, meldPoints: 40, meldsCounted: false, delta: 0 },
      ],
    });
  });

  it('zieht beim verfehlten Gebot den doppelten Reizwert ab, Gegner regulär', () => {
    const { outcome, parties } = score({ bid: 190 });

    expect(outcome).toBe('failed');
    expect(parties[1]).toMatchObject({ trickPoints: 80, meldsCounted: false, delta: -380 });
    expect(parties.map((party) => party.delta)).toEqual([40, -380, 0]);
  });

  it('gibt die 10 für den letzten Stich der Gegenpartei, die ihn gewinnt', () => {
    const { outcome, parties } = score({ tricks: [eichel(1), gruen(0), herz(2)] });

    // Spielmacher 25 + 21 = 46 → 50; Sitz 2: 23 + 10 = 33 → 30, mit Stich zählen seine 40.
    expect(parties.map((party) => [party.eyes, party.trickPoints, party.delta])).toEqual([
      [16, 20, 40],
      [46, 50, -360],
      [33, 30, 70],
    ]);
    expect(outcome).toBe('failed');
  });

  it('zählt den gedrückten Dabb nicht als Stich', () => {
    const { parties } = score({ tricks: [eichel(0), gruen(0), herz(2)] });

    expect(parties[1]).toMatchObject({ eyes: 21, tricksWon: 0, meldsCounted: false });
  });

  it.each<[PlayerCount, number]>([
    [3, 30],
    [4, 40],
  ])(
    'zieht beim Abgehen den einfachen Reizwert ab, Gegner bekommen Meldungen plus n · 10 (%i Spieler)',
    (playerCount, bonus) => {
      const melds = playerCount === 3 ? [20, null, 40] : [20, null, 0, null];
      const result = score({ playerCount, mode: 'abgehen', tricks: [], melds });
      const opponents = playerCount === 3 ? [0, 2] : [0];

      expect(result.outcome).toBe('abgehen');
      expect(result.parties[1]).toEqual({
        eyes: 0,
        tricksWon: 0,
        trickPoints: 0,
        meldPoints: 0,
        meldsCounted: false,
        delta: -180,
      });
      for (const party of opponents) {
        // Ohne Stichspiel gilt keine Stichklausel.
        expect(result.parties[party]).toMatchObject({
          meldsCounted: true,
          delta: result.parties[party].meldPoints + bonus,
        });
      }
      expect(result.parties[0].meldPoints).toBe(20);
    },
  );

  it('rechnet bei 4 Spielern Augen und Meldungen beider Partner zusammen', () => {
    const fourTricks = [
      trick(3, c('eichel', 'ass'), c('eichel', 'zehn'), c('eichel', 'koenig'), c('eichel', 'ober')),
      trick(0, c('gruen', 'ass'), c('gruen', 'unter'), c('gruen', 'ober'), c('gruen', 'koenig')),
    ];
    const { parties } = score({
      playerCount: 4,
      bid: 150,
      tricks: fourTricks,
      melds: [20, 60, 40, 80],
    });

    // Partei 1 (Sitze 1 und 3): Eichel 28 + letzter Stich fehlt + Dabb 21 = 49 → 50, Meldungen 140.
    // Partei 0 (Sitze 0 und 2): Grün 20 + letzter Stich 10 = 30, Meldungen 60.
    expect(parties).toEqual([
      { eyes: 30, tricksWon: 1, trickPoints: 30, meldPoints: 60, meldsCounted: true, delta: 90 },
      { eyes: 49, tricksWon: 1, trickPoints: 50, meldPoints: 140, meldsCounted: true, delta: 190 },
    ]);
  });

  it('rechnet nur angesagte Runden ab', () => {
    expect(() => scoreRound({ ...round(), declaration: null }, configFor(3))).toThrow();
    expect(() => scoreRound({ ...round(), declarer: null }, configFor(3))).toThrow();
  });
});
