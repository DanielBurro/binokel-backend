import { describe, expect, it } from 'vitest';
import { cardEyes, type Card } from '../cards/card';
import { buildDeck } from '../cards/deck';
import { handSize } from '../config/deal-pattern';
import {
  NO_SPECIAL_RULES,
  type DeckSize,
  type GameConfig,
  type PlayerCount,
} from '../config/game-config';
import { chooseMove, seededRandom, shuffle } from '../../test/random-bot';
import { applyIntent } from './apply-intent';
import { activeSeat, createGame, type GameState, type Phase } from './game-state';
import { SYSTEM } from './intents';
import { legalIntents } from './legal-intents';

/*
 * Simulationstest (Planschritt 32, Abnahme von M2): Ein Zufalls-Bot spielt viele Runden in allen
 * vier Konfigurationen und prüft nach jedem Zug die Invarianten. Er wächst mit jedem Regelschritt,
 * bis er ganze Partien bis zum Spielende spielt.
 */

/** Bis hierhin reichen die umgesetzten Regeln; ab Schritt 14 rückt das weiter. */
const LAST_REACHABLE_PHASE: Phase = 'declare';
const ROUNDS_PER_CONFIG = 500;
/** Obergrenze gegen Endlosschleifen; eine Runde braucht bisher höchstens rund 100 Züge. */
const MAX_MOVES = 500;
const DECK_EYES = 240;

const configs: [PlayerCount, DeckSize][] = [
  [3, 40],
  [3, 48],
  [4, 40],
  [4, 48],
];

const configFor = (playerCount: PlayerCount, deckSize: DeckSize): GameConfig => ({
  playerCount,
  deckSize,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
});

/** Jede Karte liegt genau einmal auf einer Hand, im Dabb oder bei den gedrückten Karten. */
function cardsInPlay(state: GameState): Card[] {
  const { hands, dabb, dabbStatus, discarded } = state.round!;
  return [...hands.flat(), ...(dabbStatus === 'table' ? dabb : []), ...discarded];
}

function checkInvariants(state: GameState, seed: number): void {
  const { config, round } = state;
  const deck = buildDeck(config.deckSize);
  const context = `Seed ${seed}, Version ${state.version}`;

  const inPlay = cardsInPlay(state);
  expect(inPlay.map((card) => card.id).sort(), context).toEqual(deck.map((card) => card.id).sort());
  expect(
    inPlay.reduce((sum, card) => sum + cardEyes(card), 0),
    context,
  ).toBe(DECK_EYES);

  // Außer dem Spielmacher behält jeder seine ausgeteilte Kartenzahl.
  round!.hands.forEach((hand, seat) => {
    if (seat !== round!.declarer) expect(hand, context).toHaveLength(handSize(config));
  });

  // Genau der Sitz aus activeSeat hat Angebote, sonst niemand.
  const offering = round!.hands
    .map((_, seat) => seat)
    .filter((seat) => legalIntents(state, seat).length > 0);
  const active = activeSeat(state);
  expect(offering, context).toEqual(active === null ? [] : [active]);
}

function playRound(config: GameConfig, seed: number): GameState {
  const random = seededRandom(seed);
  const dealer = random(config.playerCount);
  const started = applyIntent(createGame(config, dealer), SYSTEM, {
    type: 'startRound',
    shuffledDeck: shuffle(buildDeck(config.deckSize), random),
  });
  if (!started.ok) throw new Error(`Seed ${seed}: ${started.code}`);

  let state = started.state;
  for (let moves = 0; moves < MAX_MOVES; moves++) {
    checkInvariants(state, seed);
    const move = chooseMove(state, random);
    if (move === null) return state;

    const result = applyIntent(state, move.seat, move.intent);
    if (!result.ok) {
      throw new Error(`Seed ${seed}: ${JSON.stringify(move)} abgelehnt mit ${result.code}`);
    }
    expect(result.state.version, `Seed ${seed}`).toBe(state.version + 1);
    state = result.state;
  }
  throw new Error(`Seed ${seed}: nach ${MAX_MOVES} Zügen kein Ende`);
}

describe('Simulation mit Zufalls-Bot', () => {
  it.each(configs)(
    'spielt bei %i Spielern und %i Karten jede Runde ohne Invariantenverletzung durch',
    (playerCount, deckSize) => {
      const config = configFor(playerCount, deckSize);
      for (let round = 0; round < ROUNDS_PER_CONFIG; round++) {
        const seed = playerCount * 100_000 + deckSize * 1_000 + round;
        const end = playRound(config, seed);

        // Kein Deadlock: Bietet niemand mehr etwas an, ist die letzte erreichbare Phase erreicht.
        expect(end.phase, `Seed ${seed}`).toBe(LAST_REACHABLE_PHASE);
        expect(end.round!.dabbStatus, `Seed ${seed}`).toBe('discarded');
        expect(end.round!.hands[end.round!.declarer!], `Seed ${seed}`).toHaveLength(
          handSize(config),
        );
      }
    },
  );

  it('ist über den Seed reproduzierbar', () => {
    const config = configFor(4, 48);

    expect(playRound(config, 42)).toEqual(playRound(config, 42));
    expect(playRound(config, 42)).not.toEqual(playRound(config, 43));
  });
});
