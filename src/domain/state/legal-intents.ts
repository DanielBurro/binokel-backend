import type { Seat } from '../rules/parties';
import { BID_STEP, MAX_BID, minimumBid } from './bidding';
import { activeSeat, type GameState } from './game-state';
import type { LegalIntent } from './intents';

/**
 * Einzige Quelle für die erlaubten Züge eines Sitzes: Sie speist `availableActions` der
 * Projektion und den Zufalls-Bot des Simulationstests. Jeder Zug, den sie anbietet, muss von
 * `applyIntent` angenommen werden. Die übrigen Phasen kommen mit den Schritten 13–18 hinzu.
 */
export function legalIntents(state: GameState, seat: Seat): readonly LegalIntent[] {
  const { phase, round } = state;
  if (phase !== 'bidding' || round === null || activeSeat(state) !== seat) return [];
  return [
    { type: 'bid', min: minimumBid(round.bidding), max: MAX_BID, step: BID_STEP },
    { type: 'pass' },
  ];
}
