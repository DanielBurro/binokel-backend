import type { Card } from '../cards/card';
import { buildDeck } from '../cards/deck';
import type { DeckSize } from '../config/game-config';
import { deal, forehandOf } from '../rules/deal';
import { isSeat, type Seat } from '../rules/parties';
import { bid, openBidding, pass } from './bidding';
import { discardToDabb, takeDabb } from './dabb';
import { declare } from './declare';
import { nextMelder, submitMelds } from './melding';
import { scoreRound } from './scoring';
import { playCard } from './trick-play';
import { nextPhase, type AbortReason, type GameState, type RoundState } from './game-state';
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
  switch (intent.type) {
    case 'bid':
    case 'pass':
      return applyBidding(state, seat, intent);
    case 'takeDabb':
    case 'discardToDabb':
      return applyDabb(state, seat, intent);
    case 'declare':
      return applyDeclare(state, seat, intent);
    case 'submitMelds':
      return applyMelds(state, seat, intent);
    case 'playCard':
      return applyPlayCard(state, seat, intent);
    // Die Bestätigung der nächsten Runde folgt mit Schritt 18.
    default:
      return fail('WRONG_PHASE');
  }
}

function applyDabb(
  state: GameState,
  seat: Seat,
  intent: Extract<PlayerIntent, { type: 'takeDabb' | 'discardToDabb' }>,
): IntentResult {
  const { round } = state;
  if (state.phase !== 'dabb' || round === null) return fail('WRONG_PHASE');

  const result =
    intent.type === 'takeDabb' ? takeDabb(round, seat) : discardToDabb(round, seat, intent.cardIds);
  if (!result.ok) return result;

  const done = result.round.dabbStatus === 'discarded';
  return commit(
    state,
    { phase: done ? nextPhase(state) : state.phase, round: result.round },
    result.events,
  );
}

function applyDeclare(
  state: GameState,
  seat: Seat,
  intent: Extract<PlayerIntent, { type: 'declare' }>,
): IntentResult {
  const { round } = state;
  if (state.phase !== 'declare' || round === null) return fail('WRONG_PHASE');

  const result = declare(round, seat, { trump: intent.trump, mode: intent.mode });
  if (!result.ok) return result;
  // Auch beim Abgehen folgt das Melden; dort melden nur die Gegenparteien (Schritt 15).
  return commit(state, { phase: nextPhase(state), round: result.round }, result.events);
}

function applyMelds(
  state: GameState,
  seat: Seat,
  intent: Extract<PlayerIntent, { type: 'submitMelds' }>,
): IntentResult {
  const { round, config } = state;
  if (state.phase !== 'meld' || round === null) return fail('WRONG_PHASE');

  const result = submitMelds(round, seat, intent.meldIds, config);
  if (!result.ok) return result;
  // Haben alle gemeldet, folgt das Stichspiel, beim Abgehen direkt die Abrechnung.
  if (nextMelder(result.round, config.playerCount) !== null) {
    return commit(state, { round: result.round }, result.events);
  }
  return advance(state, result.round, result.events);
}

function applyPlayCard(
  state: GameState,
  seat: Seat,
  intent: Extract<PlayerIntent, { type: 'playCard' }>,
): IntentResult {
  const { round, config } = state;
  if (state.phase !== 'trick' || round === null) return fail('WRONG_PHASE');

  const result = playCard(round, seat, intent.cardId, config);
  if (!result.ok) return result;
  // Sind alle Hände leer, ist der letzte Stich gespielt, und die Abrechnung folgt.
  if (result.round.hands.some((hand) => hand.length > 0)) {
    return commit(state, { round: result.round }, result.events);
  }
  return advance(state, result.round, result.events);
}

/**
 * Wechselt in die Folgephase. Mit dem Eintritt in die Abrechnung wird die Runde gewertet, und die
 * Punktestände der Parteien werden fortgeschrieben (Studienarbeit FA-20).
 */
function advance(state: GameState, round: RoundState, events: readonly GameEvent[]): IntentResult {
  const phase = nextPhase(state);
  if (phase !== 'score') return commit(state, { phase, round }, events);

  const result = scoreRound(round, state.config);
  return commit(
    state,
    {
      phase,
      round: { ...round, result },
      scores: state.scores.map((score, party) => score + result.parties[party].delta),
    },
    [...events, { type: 'roundScored', outcome: result.outcome }],
  );
}

function applyBidding(
  state: GameState,
  seat: Seat,
  intent: Extract<PlayerIntent, { type: 'bid' | 'pass' }>,
): IntentResult {
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
        dabbStatus: 'table',
        discarded: [],
        bidding: openBidding(forehand, config.playerCount),
        declarer: null,
        declaration: null,
        melds: hands.map(() => null),
        trick: [],
        tricks: [],
        result: null,
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
