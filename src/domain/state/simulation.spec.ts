import { describe, expect, it } from 'vitest';
import { cardEyes, SUITS, type Card } from '../cards/card';
import { partyOf, type Seat } from '../rules/parties';
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
import { activeSeat, createGame, DECLARE_MODES, type GameState, type Phase } from './game-state';
import { SYSTEM } from './intents';
import { legalIntents } from './legal-intents';
import { MELD_GROUP, MELD_GROUPS, meldPoints } from '../melds/meld';

/*
 * Simulationstest (Planschritt 32, Abnahme von M2): Ein Zufalls-Bot spielt viele Runden in allen
 * vier Konfigurationen und prüft nach jedem Zug die Invarianten. Er wächst mit jedem Regelschritt,
 * bis er ganze Partien bis zum Spielende spielt.
 */

/**
 * Bis hierhin reichen die umgesetzten Regeln: nach dem Melden das Stichspiel, beim Abgehen die
 * Abrechnung. Ab Schritt 16 rückt das weiter.
 */
const lastReachablePhase = (state: GameState): Phase =>
  state.round!.declaration!.mode === 'abgehen' ? 'score' : 'trick';
const ROUNDS_PER_CONFIG = 500;
/** Obergrenze gegen Endlosschleifen; eine Runde braucht bisher höchstens rund 100 Züge. */
const MAX_MOVES = 500;
const DECK_EYES = 240;
/** Phasen, in denen noch nicht angesagt ist. */
const BEFORE_DECLARATION: ReadonlySet<Phase> = new Set(['bidding', 'dabb', 'declare']);

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

/** Unabhängig von der Engine formuliert: Beim Abgehen meldet die Partei des Spielmachers nicht. */
function eligible(state: GameState, seat: Seat): boolean {
  const { declarer, declaration } = state.round!;
  const n = state.config.playerCount;
  return declaration!.mode === 'play' || partyOf(seat, n) !== partyOf(declarer!, n);
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

  // Trumpf und Spielart stehen genau ab dem Ende der Ansage fest.
  expect(round!.declaration === null, context).toBe(BEFORE_DECLARATION.has(state.phase));

  // Meldungen: nur Berechtigte, nur eigene Karten, je Gruppe kartendisjunkt, Punkte als Summe.
  // Bis zum Stichspiel liegen gemeldete Karten noch auf der Hand.
  round!.melds.forEach((entry, seat) => {
    if (entry === null) return;
    expect(eligible(state, seat), context).toBe(true);
    expect(entry.points, context).toBe(meldPoints(entry.melds));
    const own = new Set(round!.hands[seat].map((card) => card.id));
    for (const group of MELD_GROUPS) {
      const ids = entry.melds
        .filter((meld) => MELD_GROUP[meld.kind] === group)
        .flatMap((meld) => meld.cards.map((card) => card.id));
      expect(new Set(ids).size, context).toBe(ids.length);
      for (const id of ids) expect(own.has(id), context).toBe(true);
    }
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
      const declarations = new Set<string>();
      const meldKinds = new Set<string>();
      for (let round = 0; round < ROUNDS_PER_CONFIG; round++) {
        const seed = playerCount * 100_000 + deckSize * 1_000 + round;
        const end = playRound(config, seed);

        // Kein Deadlock: Bietet niemand mehr etwas an, ist die letzte erreichbare Phase erreicht.
        expect(end.phase, `Seed ${seed}`).toBe(lastReachablePhase(end));
        expect(end.round!.dabbStatus, `Seed ${seed}`).toBe('discarded');
        expect(end.round!.hands[end.round!.declarer!], `Seed ${seed}`).toHaveLength(
          handSize(config),
        );
        const { trump, mode } = end.round!.declaration!;
        declarations.add(`${trump}/${mode}`);

        // Am Ende hat jeder Berechtigte gemeldet, und nur die.
        end.round!.melds.forEach((entry, seat) => {
          expect(entry !== null, `Seed ${seed}, Sitz ${seat}`).toBe(eligible(end, seat));
          entry?.melds.forEach((meld) => meldKinds.add(meld.kind));
        });
      }

      // Der Bot hat jede Kombination aus Trumpf und Spielart mindestens einmal durchgespielt.
      expect(declarations.size).toBe(SUITS.length * DECLARE_MODES.length);
      // Die häufigen Meldearten kommen vor; den Diß gibt es nur bei 48 Karten. Die 1000er sind
      // zu selten für eine feste Erwartung, sie deckt der Property-Test von bestMelds ab.
      const common = ['paar', 'familie', 'binokel', 'vierGleiche'];
      expect([...meldKinds]).toEqual(
        expect.arrayContaining(deckSize === 48 ? [...common, 'diss'] : common),
      );
      expect(meldKinds.has('diss')).toBe(deckSize === 48);
    },
  );

  it('ist über den Seed reproduzierbar', () => {
    const config = configFor(4, 48);

    expect(playRound(config, 42)).toEqual(playRound(config, 42));
    expect(playRound(config, 42)).not.toEqual(playRound(config, 43));
  });
});
