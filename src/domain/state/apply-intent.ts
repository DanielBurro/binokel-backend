import type { Card } from '../cards/card';
import { buildDeck } from '../cards/deck';
import type { DeckSize } from '../config/game-config';
import { deal, forehandOf } from '../rules/deal';
import { isSeat, type Seat } from '../rules/parties';
import { bid, openBidding, pass } from './bidding';
import { nextPhase, type AbortReason, type GameState } from './game-state';
import {
  SYSTEM,
  fail,
  type Actor,
  type GameEvent,
  type Intent,
  type IntentResult,
  type PlayerIntent,
  type SystemIntent,
} from './intents';

/**
 * Zentrale Zustandsmaschine. Bei Fehlern bleibt der Zustand unverändert (NFA-04),
 * bei Erfolg steigt `version` um eins.
 */
export function applyIntent(state: GameState, actor: Actor, intent: Intent): IntentResult {
  if (actor === SYSTEM) {
    return isSystemIntent(intent) ? applySystemIntent(state, intent) : fail('INVALID_ACTOR');
  }
  if (isSystemIntent(intent) || !isSeat(actor, state.config.playerCount)) {
    return fail('INVALID_ACTOR');
  }
  return applyPlayerIntent(state, actor, intent);
}

function isSystemIntent(intent: Intent): intent is SystemIntent {
  return intent.type === 'startRound' || intent.type === 'abortGame';
}

function applySystemIntent(state: GameState, intent: SystemIntent): IntentResult {
  switch (intent.type) {
    case 'startRound':
      return startRound(state, intent.shuffledDeck);
    case 'abortGame':
      return abortGame(state, intent.reason);
  }
}

function applyPlayerIntent(state: GameState, seat: Seat, intent: PlayerIntent): IntentResult {
  const { round } = state;
  if (state.phase !== 'bidding' || round === null) return fail('WRONG_PHASE');

  const { playerCount } = state.config;
  const result =
    intent.type === 'bid'
      ? bid(round.bidding, seat, intent.amount, playerCount)
      : pass(round.bidding, seat, playerCount);
  if (!result.ok) return result;

  const decided = result.bidding.activeSeat === null;
  return commit(
    state,
    {
      phase: decided ? nextPhase(state) : state.phase,
      round: {
        ...round,
        bidding: result.bidding,
        declarer: decided ? result.bidding.highestBidder : null,
      },
    },
    result.events,
  );
}

// Ab Schritt 18 startet die nächste Runde auch nach der Abrechnung.
function startRound(state: GameState, shuffledDeck: readonly Card[]): IntentResult {
  if (state.phase !== 'created') return fail('WRONG_PHASE');
  const { config, dealer } = state;
  if (!isCompleteDeck(shuffledDeck, config.deckSize)) return fail('INVALID_DECK');

  const { hands, dabb } = deal(shuffledDeck, config, dealer);
  const forehand = forehandOf(dealer, config.playerCount);
  return commit(
    state,
    {
      phase: 'bidding',
      round: {
        dealer,
        forehand,
        hands,
        dabb,
        bidding: openBidding(forehand, config.playerCount),
        declarer: null,
      },
    },
    [{ type: 'roundStarted', dealer, forehand }],
  );
}

function abortGame(state: GameState, reason: AbortReason): IntentResult {
  if (state.phase === 'terminated') return fail('WRONG_PHASE');
  return commit(state, { phase: 'terminated', abortReason: reason }, [
    { type: 'gameAborted', reason },
  ]);
}

/** Das gemischte Blatt muss jede Karte der Konfiguration genau einmal enthalten. */
function isCompleteDeck(cards: readonly Card[], deckSize: DeckSize): boolean {
  const ids = new Set(cards.map((card) => card.id));
  return (
    cards.length === deckSize &&
    ids.size === deckSize &&
    buildDeck(deckSize).every((card) => ids.has(card.id))
  );
}

function commit(
  state: GameState,
  changes: Partial<Omit<GameState, 'config' | 'version'>>,
  events: readonly GameEvent[],
): IntentResult {
  return { ok: true, state: { ...state, ...changes, version: state.version + 1 }, events };
}
