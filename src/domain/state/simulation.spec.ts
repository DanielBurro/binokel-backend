import { describe, expect, it } from 'vitest';
import { cardEyes, RANK_STRENGTH, SUITS, type Card } from '../cards/card';
import { partyOf, type Seat } from '../rules/parties';
import type { TrickPlay } from '../rules/trick';
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

/** Bis hierhin reichen die umgesetzten Regeln; mit Schritt 18 folgen weitere Runden. */
const LAST_REACHABLE_PHASE: Phase = 'score';
const ROUNDS_PER_CONFIG = 500;
/** Obergrenze gegen Endlosschleifen; eine Runde braucht höchstens rund 150 Züge (Reizen bis 1000, alle Karten). */
const MAX_MOVES = 500;
const DECK_EYES = 240;
/**
 * 500 ganze Runden je Konfiguration brauchen lokal rund 1 s, auf dem CI-Runner mit Coverage aber
 * über 5 s, das Standardlimit von Vitest. Großzügig bemessen, weil der Test mit Schritt 17 und 18
 * weiter wächst.
 */
const SIMULATION_TIMEOUT_MS = 60_000;
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

/** Jede Karte liegt genau einmal auf einer Hand, im Dabb, bei den gedrückten Karten oder im Stich. */
function cardsInPlay(state: GameState): Card[] {
  const { hands, dabb, dabbStatus, discarded } = state.round!;
  return [
    ...hands.flat(),
    ...(dabbStatus === 'table' ? dabb : []),
    ...discarded,
    ...playedCards(state).map((play) => play.card),
  ];
}

/** Alle gelegten Karten der Runde: abgeschlossene Stiche und der laufende. */
function playedCards(state: GameState): TrickPlay[] {
  const { trick, tricks } = state.round!;
  return [...tricks.flatMap((done) => done.plays), ...trick];
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

  // Außer dem Spielmacher vor dem Drücken hält jeder seine ausgeteilte Kartenzahl, abzüglich
  // der Karten, die er schon gelegt hat.
  round!.hands.forEach((hand, seat) => {
    if (seat === round!.declarer && round!.dabbStatus !== 'discarded') return;
    const played = playedCards(state).filter((play) => play.seat === seat).length;
    expect(hand.length + played, context).toBe(handSize(config));
  });

  // Trumpf und Spielart stehen genau ab dem Ende der Ansage fest.
  expect(round!.declaration === null, context).toBe(BEFORE_DECLARATION.has(state.phase));

  // Meldungen: nur Berechtigte, nur eigene Karten, je Gruppe kartendisjunkt, Punkte als Summe.
  // Gemeldete Karten liegen auf der Hand des Sitzes oder wurden von ihm schon gelegt.
  round!.melds.forEach((entry, seat) => {
    if (entry === null) return;
    expect(eligible(state, seat), context).toBe(true);
    expect(entry.points, context).toBe(meldPoints(entry.melds));
    const own = new Set(
      [
        ...round!.hands[seat],
        ...playedCards(state)
          .filter((play) => play.seat === seat)
          .map((play) => play.card),
      ].map((card) => card.id),
    );
    for (const group of MELD_GROUPS) {
      const ids = entry.melds
        .filter((meld) => MELD_GROUP[meld.kind] === group)
        .flatMap((meld) => meld.cards.map((card) => card.id));
      expect(new Set(ids).size, context).toBe(ids.length);
      for (const id of ids) expect(own.has(id), context).toBe(true);
    }
  });

  // Genau der Sitz aus activeSeat hat Angebote, sonst niemand. In der Abrechnung ist niemand
  // allein am Zug, dort bestätigt jeder, der es noch nicht getan hat, die nächste Runde.
  const seats = round!.hands.map((_, seat) => seat);
  const offering = seats.filter((seat) => legalIntents(state, seat).length > 0);
  const active = activeSeat(state);
  if (state.phase === 'score') {
    expect(active, context).toBeNull();
    expect(offering, context).toEqual(seats.filter((seat) => !round!.ready.includes(seat)));
  } else {
    expect(offering, context).toEqual(active === null ? [] : [active]);
  }
}

/**
 * Stichgewinner, unabhängig von der Engine nach dem Wortlaut der Spielregeln: Liegt Trumpf, sticht
 * der höchste Trumpf, sonst die höchste Karte der angespielten Farbe. Von zwei gleichen Karten
 * sticht die zuerst gelegte.
 */
function expectedWinner(plays: readonly TrickPlay[], trump: string): Seat {
  const trumps = plays.filter((play) => play.card.suit === trump);
  const led = plays.filter((play) => play.card.suit === plays[0].card.suit);
  const pool = trumps.length > 0 ? trumps : led;
  const best = Math.max(...pool.map((play) => RANK_STRENGTH[play.card.rank]));
  return pool.find((play) => RANK_STRENGTH[play.card.rank] === best)!.seat;
}

/** Abgeschlossene Stiche: Ausspielreihenfolge, Anspielrecht und Gewinner. */
function checkTricks(state: GameState, context: string): void {
  const { tricks, forehand, declaration } = state.round!;
  const n = state.config.playerCount;
  tricks.forEach((trick, index) => {
    const leader = index === 0 ? forehand : tricks[index - 1].winner;
    expect(
      trick.plays.map((play) => play.seat),
      context,
    ).toEqual(Array.from({ length: n }, (_, offset) => (leader + offset) % n));
    expect(trick.winner, context).toBe(expectedWinner(trick.plays, declaration!.trump));
  });
}

/** Farb- und Trumpfzwang aus Sicht des Sitzes, der gerade eine Karte legt. */
function checkFollowing(state: GameState, seat: Seat, cardId: string, context: string): void {
  const { trick, hands, declaration } = state.round!;
  if (trick.length === 0) return;
  const led = trick[0].card.suit;
  const hand = hands[seat];
  const card = hand.find((own) => own.id === cardId)!;
  if (hand.some((own) => own.suit === led)) {
    expect(card.suit, `${context}: Farbzwang`).toBe(led);
  } else if (hand.some((own) => own.suit === declaration!.trump)) {
    expect(card.suit, `${context}: Trumpfzwang`).toBe(declaration!.trump);
  }
}

/** Ungerundete Augenbilanz eines gespielten Spiels: 240 aus den Karten plus 10 für den letzten Stich. */
const PLAYED_ROUND_EYES = 250;

/**
 * Prüft die Wertung einer fertigen Runde gegen die Tabelle „Rundenwertung“ der Studienarbeit. Augen,
 * Rundung und Meldesummen rechnet der Test selbst aus, je Sitz statt je Partei aufsummiert.
 */
function checkScoring(end: GameState, context: string): void {
  const { round, config } = end;
  const { result, declarer, declaration, bidding, tricks, melds, discarded } = round!;
  const n = config.playerCount;
  const bid = bidding.highestBid;
  const own = partyOf(declarer!, n);
  expect(result, context).not.toBeNull();
  const parties = result!.parties;

  const meldSum = parties.map(() => 0);
  melds.forEach((entry, seat) => (meldSum[partyOf(seat, n)] += entry?.points ?? 0));
  parties.forEach((party, index) => expect(party.meldPoints, context).toBe(meldSum[index]));

  if (declaration!.mode === 'abgehen') {
    expect(result!.outcome, context).toBe('abgehen');
    parties.forEach((party, index) =>
      expect(party.delta, context).toBe(index === own ? -bid : meldSum[index] + 10 * n),
    );
  } else {
    const eyes = parties.map(() => 0);
    const won = parties.map(() => 0);
    for (const trick of tricks) {
      won[partyOf(trick.winner, n)] += 1;
      for (const play of trick.plays) eyes[partyOf(trick.winner, n)] += cardEyes(play.card);
    }
    eyes[partyOf(tricks[tricks.length - 1].winner, n)] += 10;
    for (const card of discarded) eyes[own] += cardEyes(card);
    expect(
      eyes.reduce((sum, value) => sum + value, 0),
      context,
    ).toBe(PLAYED_ROUND_EYES);

    const earned = eyes.map((value, index) => {
      const rounded = Math.round(value / 10) * 10;
      expect(parties[index].trickPoints, context).toBe(rounded);
      return rounded + (won[index] >= 1 ? meldSum[index] : 0);
    });
    const made = earned[own] >= bid;
    expect(result!.outcome, context).toBe(made ? 'made' : 'failed');
    parties.forEach((party, index) =>
      expect(party.delta, context).toBe(index === own && !made ? -2 * bid : earned[index]),
    );
  }

  // Erste Runde: Die Punktestände sind genau die Veränderungen dieser Runde.
  expect(end.scores, context).toEqual(parties.map((party) => party.delta));
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
    checkTricks(state, `Seed ${seed}, Version ${state.version}`);
    const move = chooseMove(state, random);
    if (move === null) return state;
    if (move.intent.type === 'playCard') {
      checkFollowing(
        state,
        move.seat,
        move.intent.cardId,
        `Seed ${seed}, Version ${state.version}`,
      );
    }

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
      const outcomes = new Set<string>();
      for (let round = 0; round < ROUNDS_PER_CONFIG; round++) {
        const seed = playerCount * 100_000 + deckSize * 1_000 + round;
        const end = playRound(config, seed);

        // Kein Deadlock: Bietet niemand mehr etwas an, ist die letzte erreichbare Phase erreicht.
        expect(end.phase, `Seed ${seed}`).toBe(LAST_REACHABLE_PHASE);
        expect(end.round!.dabbStatus, `Seed ${seed}`).toBe('discarded');
        // Gespielt wird die Runde nur ohne Abgehen, dann bis zur letzten Karte.
        const tricks = end.round!.declaration!.mode === 'play' ? handSize(config) : 0;
        expect(end.round!.tricks, `Seed ${seed}`).toHaveLength(tricks);
        expect(end.round!.hands.flat(), `Seed ${seed}`).toHaveLength(
          (handSize(config) - tricks) * playerCount,
        );
        const { trump, mode } = end.round!.declaration!;
        declarations.add(`${trump}/${mode}`);
        checkScoring(end, `Seed ${seed}`);
        outcomes.add(end.round!.result!.outcome);

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
      // Der Bot erreicht, verfehlt und geht ab.
      expect([...outcomes].sort()).toEqual(['abgehen', 'failed', 'made']);
    },
    SIMULATION_TIMEOUT_MS,
  );

  it('ist über den Seed reproduzierbar', () => {
    const config = configFor(4, 48);

    expect(playRound(config, 42)).toEqual(playRound(config, 42));
    expect(playRound(config, 42)).not.toEqual(playRound(config, 43));
  });
});
