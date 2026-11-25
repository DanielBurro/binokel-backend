import type { PartyId } from '../rules/parties';

/** Ab diesem Gesamtpunktestand endet das Spiel nach der Abrechnung. */
export const WINNING_SCORE = 1000;

/**
 * Spielende nach Studienarbeit, Phase 8: Hat nach einer Abrechnung mindestens eine Partei 1000
 * Punkte, gewinnt die Partei mit dem höchsten Gesamtpunktestand. Ist dieser geteilt, wird eine
 * weitere Runde gespielt (Festlegung), dann liefert die Funktion null, ebenso unter 1000.
 */
export function winningParty(scores: readonly number[]): PartyId | null {
  const best = Math.max(...scores);
  if (best < WINNING_SCORE) return null;
  const leaders = scores.flatMap((score, party) => (score === best ? [party] : []));
  return leaders.length === 1 ? leaders[0] : null;
}
