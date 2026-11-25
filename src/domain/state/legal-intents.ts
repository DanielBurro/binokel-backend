import type { Seat } from '../rules/parties';
import { BID_STEP, MAX_BID, minimumBid } from './bidding';
import { DECLARE_MODES, type GameState } from './game-state';
import { nextMelder, offeredMelds } from './melding';
import { nextPlayer, playableCards } from './trick-play';
import type { LegalIntent } from './intents';

/**
 * Einzige Quelle für die erlaubten Züge eines Sitzes: Sie speist `availableActions` der
 * Projektion und den Zufalls-Bot des Simulationstests. Jeder Zug, den sie anbietet, muss von
 * `applyIntent` angenommen werden, und nur der Sitz aus `activeSeat` bekommt Angebote. Die
 * Bestätigung der nächsten Runde kommt mit Schritt 18 hinzu.
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
    case 'meld':
      if (seat !== nextMelder(round, state.config.playerCount)) return [];
      return [{ type: 'submitMelds', melds: offeredMelds(round, seat, state.config) }];
    case 'trick':
      if (seat !== nextPlayer(round, state.config.playerCount)) return [];
      return [{ type: 'playCard', cardIds: playableCards(round, seat).map((card) => card.id) }];
    default:
      return [];
  }
}
