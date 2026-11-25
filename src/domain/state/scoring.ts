import { cardEyes, type Card } from '../cards/card';
import type { GameConfig } from '../config/game-config';
import { partyCount, partyOf, type PartyId } from '../rules/parties';
import { discardedEyes } from './dabb';
import type { PartyResult, RoundResult, RoundState } from './game-state';

/** Bonus für den letzten Stich. */
export const LAST_TRICK_BONUS = 10;
/** Beim Abgehen bekommt jede Gegenpartei 10 Punkte je Spieler am Tisch. */
export const ABGEHEN_BONUS_PER_PLAYER = 10;

/** Rundung auf den nächsten vollen Zehner, Endziffer 5 rundet auf: 10 · ⌊(x + 5) / 10⌋. */
export function roundToTen(value: number): number {
  return 10 * Math.floor((value + 5) / 10);
}

/**
 * Rundenwertung nach Studienarbeit, Phase 7 und Tabelle „Rundenwertung“:
 * - E(Π) = Stich(Π) + Melde*(Π), Meldepunkte nur mit mindestens einem Stich (Stichklausel).
 * - Gebot erreicht, wenn E der Spielmacher-Partei ≥ Reizwert: alle bekommen E.
 * - Gebot verfehlt: Spielmacher-Partei −2 · Reizwert, Gegner E.
 * - Abgehen: Spielmacher-Partei −Reizwert, Gegner ihre Meldepunkte ohne Stichklausel plus n · 10.
 * Erwartet eine fertige Runde: angesagt, und ohne Abgehen alle Stiche gespielt.
 */
export function scoreRound(round: RoundState, config: GameConfig): RoundResult {
  const { declarer, declaration, bidding } = round;
  if (declarer === null || declaration === null) {
    throw new Error('Nur eine angesagte Runde kann abgerechnet werden');
  }
  const { playerCount } = config;
  const bid = bidding.highestBid;
  const declarerParty = partyOf(declarer, playerCount);
  const parties = Array.from({ length: partyCount(playerCount) }, (_, party) => party);
  const melds = parties.map((party) => meldPointsOf(round, party, config));

  if (declaration.mode === 'abgehen') {
    // Kein Stichspiel: keine Augen, und die Gegner melden ohne Stichklausel.
    return {
      outcome: 'abgehen',
      parties: parties.map((party) => {
        const opponent = party !== declarerParty;
        return {
          eyes: 0,
          tricksWon: 0,
          trickPoints: 0,
          meldPoints: melds[party],
          meldsCounted: opponent,
          delta: opponent ? melds[party] + ABGEHEN_BONUS_PER_PLAYER * playerCount : -bid,
        };
      }),
    };
  }

  const lastWinner = round.tricks[round.tricks.length - 1]?.winner;
  const played = parties.map((party): PartyResult => {
    const won = round.tricks.filter((trick) => partyOf(trick.winner, playerCount) === party);
    const eyes =
      sumEyes(won.flatMap((trick) => trick.plays.map((play) => play.card))) +
      (lastWinner !== undefined && partyOf(lastWinner, playerCount) === party
        ? LAST_TRICK_BONUS
        : 0) +
      (party === declarerParty ? discardedEyes(round) : 0);
    const trickPoints = roundToTen(eyes);
    const meldsCounted = won.length >= 1;
    return {
      eyes,
      tricksWon: won.length,
      trickPoints,
      meldPoints: melds[party],
      meldsCounted,
      // Vorerst das erspielte Ergebnis E(Π); beim verfehlten Gebot unten ersetzt.
      delta: trickPoints + (meldsCounted ? melds[party] : 0),
    };
  });

  const made = played[declarerParty].delta >= bid;
  return {
    outcome: made ? 'made' : 'failed',
    parties: played.map((entry, party) =>
      party === declarerParty && !made ? { ...entry, meldsCounted: false, delta: -2 * bid } : entry,
    ),
  };
}

function meldPointsOf(round: RoundState, party: PartyId, config: GameConfig): number {
  return round.melds.reduce(
    (sum, entry, seat) =>
      partyOf(seat, config.playerCount) === party ? sum + (entry?.points ?? 0) : sum,
    0,
  );
}

function sumEyes(cards: readonly Card[]): number {
  return cards.reduce((sum, card) => sum + cardEyes(card), 0);
}
