import type { Seat } from '../rules/parties';
import { BID_STEP, MAX_BID, minimumBid } from './bidding';
import { DECLARE_MODES, type GameState } from './game-state';
import type { LegalIntent } from './intents';

/**
 * Einzige Quelle für die erlaubten Züge eines Sitzes: Sie speist `availableActions` der
 * Projektion und den Zufalls-Bot des Simulationstests. Jeder Zug, den sie anbietet, muss von
 * `applyIntent` angenommen werden, und nur der Sitz aus `activeSeat` bekommt Angebote. Die
 * übrigen Phasen kommen mit den Schritten 15–18 hinzu.
 */
export function legalIntents(state: GameState, seat: Seat): readonly LegalIntent[] {
  const { phase, round } = state;
  if (round === null) return [];
  switch (phase) {
    case 'bidding':
      if (seat !== round.bidding.activeSeat) return [];
      return [
        { type: 'bid', min: minimumBid(round.bidding), max: MAX_BID, step: BID_STEP },
        { type: 'pass' },
      ];
    case 'dabb':
      if (seat !== round.declarer) return [];
      return round.dabbStatus === 'table'
        ? [{ type: 'takeDabb' }]
        : [{ type: 'discardToDabb', count: round.dabb.length }];
    case 'declare':
      // Jede Farbe darf Trumpf werden; zur Wahl steht nur noch die Spielart.
      if (seat !== round.declarer) return [];
      return [{ type: 'declare', modes: [...DECLARE_MODES] }];
    default:
      return [];
  }
}
