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
import { SYSTEM, type Intent } from './intents';
import { everyoneReady } from './next-round';
import { legalIntents } from './legal-intents';
import { MELD_GROUP, MELD_GROUPS, meldPoints } from '../melds/meld';

/*
 * Simulationstest (Planschritt 32, Abnahme von M2): Ein Zufalls-Bot spielt in allen vier
 * Konfigurationen ganze Partien bis zum Spielende und prüft nach jedem Zug die Invarianten, nach
 * jeder Runde die Wertung und am Ende den Sieger.
 */

/** Je Konfiguration; zusammen 240 Partien mit rund 2400 Runden. */
const GAMES_PER_CONFIG = 60;
/**
 * Obergrenze gegen Endlosschleifen: Eine Runde braucht höchstens rund 150 Züge (Reizen bis 1000,
 * alle Karten), eine Partie bisher wenige Dutzend Runden.
 */
const MAX_MOVES_PER_GAME = 20_000;
const DECK_EYES = 240;
/**
 * 60 Partien mit zusammen rund 600 Runden brauchen je Konfiguration lokal gut 2 s, auf dem
 * CI-Runner mit Coverage etwa das Fünffache. Das Standardlimit von Vitest (5 s) reicht dafür nicht
 * (siehe PR #26).
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
function checkScoring(end: GameState, before: readonly number[], context: string): void {
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

  // Die Punktestände wachsen genau um die Veränderungen dieser Runde.
  expect(end.scores, context).toEqual(parties.map((party, index) => before[index] + party.delta));
}

/** Spielende unabhängig von der Engine: Eine Partei liegt allein vorn, mit mindestens 1000. */
function expectedGameWinner(scores: readonly number[]): number | null {
  const best = Math.max(...scores);
  const leaders = scores.filter((score) => score === best).length;
  return best >= 1000 && leaders === 1 ? scores.indexOf(best) : null;
}

/** Was nach jeder fertigen Runde gelten muss, unabhängig davon, ob das Spiel weitergeht. */
function checkFinishedRound(scored: GameState, before: readonly number[], context: string): void {
  const { round, config } = scored;
  expect(round!.dabbStatus, context).toBe('discarded');
  // Gespielt wird die Runde nur ohne Abgehen, dann bis zur letzten Karte.
  const tricks = round!.declaration!.mode === 'play' ? handSize(config) : 0;
  expect(round!.tricks, context).toHaveLength(tricks);
  expect(round!.hands.flat(), context).toHaveLength(
    (handSize(config) - tricks) * config.playerCount,
  );
  // Am Ende hat jeder Berechtigte gemeldet, und nur die.
  round!.melds.forEach((entry, seat) =>
    expect(entry !== null, `${context}, Sitz ${seat}`).toBe(eligible(scored, seat)),
  );
  checkScoring(scored, before, context);

  // Spielende nach Phase 8: weiter in der Abrechnung, oder Schluss mit genau einem Sieger.
  const winner = expectedGameWinner(scored.scores);
  expect(scored.phase, context).toBe(winner === null ? 'score' : 'terminated');
  expect(scored.winners, context).toEqual(winner === null ? null : [winner]);
}

interface PlayedGame {
  readonly end: GameState;
  /** Der Zustand direkt nach jeder Abrechnung, in Spielreihenfolge. */
  readonly rounds: readonly GameState[];
}

/**
 * Spielt eine ganze Partie: Der Bot wählt Züge aus `legalIntents`. Haben alle die nächste Runde
 * bestätigt, teilt der Test wie der GameService mit frisch gemischtem Blatt aus.
 */
function playGame(config: GameConfig, seed: number): PlayedGame {
  const random = seededRandom(seed);
  const deal = (): Intent => ({
    type: 'startRound',
    shuffledDeck: shuffle(buildDeck(config.deckSize), random),
  });
  const started = applyIntent(createGame(config, random(config.playerCount)), SYSTEM, deal());
  if (!started.ok) throw new Error(`Seed ${seed}: ${started.code}`);

  let state = started.state;
  const rounds: GameState[] = [];
  for (let moves = 0; moves < MAX_MOVES_PER_GAME; moves++) {
    const context = `Seed ${seed}, Version ${state.version}`;
    checkInvariants(state, seed);
    checkTricks(state, context);

    if (everyoneReady(state)) {
      const next = applyIntent(state, SYSTEM, deal());
      if (!next.ok) throw new Error(`${context}: Austeilen abgelehnt mit ${next.code}`);
      // Der Geber rückt um einen Sitz weiter, die Punktestände bleiben.
      expect(next.state.dealer, context).toBe((state.dealer + 1) % config.playerCount);
      expect(next.state.scores, context).toEqual(state.scores);
      state = next.state;
      continue;
    }

    const move = chooseMove(state, random);
    if (move === null) break;
    if (move.intent.type === 'playCard') {
      checkFollowing(state, move.seat, move.intent.cardId, context);
    }
    const result = applyIntent(state, move.seat, move.intent);
    if (!result.ok) {
      throw new Error(`${context}: ${JSON.stringify(move)} abgelehnt mit ${result.code}`);
    }
    expect(result.state.version, context).toBe(state.version + 1);

    if (state.round!.result === null && result.state.round!.result !== null) {
      checkFinishedRound(result.state, state.scores, `${context}, Runde ${rounds.length + 1}`);
      rounds.push(result.state);
    }
    state = result.state;
  }

  // Kein Deadlock: Bietet niemand mehr etwas an, ist das Spiel regulär zu Ende.
  expect(state.phase, `Seed ${seed}`).toBe('terminated');
  expect(state.abortReason, `Seed ${seed}`).toBeNull();
  return { end: state, rounds };
}

describe('Simulation mit Zufalls-Bot', () => {
  it.each(configs)(
    'spielt bei %i Spielern und %i Karten ganze Partien ohne Invariantenverletzung bis zum Ende',
    (playerCount, deckSize) => {
      const config = configFor(playerCount, deckSize);
      const declarations = new Set<string>();
      const meldKinds = new Set<string>();
      const outcomes = new Set<string>();
      let totalRounds = 0;
      for (let game = 0; game < GAMES_PER_CONFIG; game++) {
        const seed = playerCount * 100_000 + deckSize * 1_000 + game;
        const { rounds } = playGame(config, seed);
        totalRounds += rounds.length;
        for (const scored of rounds) {
          const { trump, mode } = scored.round!.declaration!;
          declarations.add(`${trump}/${mode}`);
          outcomes.add(scored.round!.result!.outcome);
          scored.round!.melds.forEach((entry) =>
            entry?.melds.forEach((meld) => meldKinds.add(meld.kind)),
          );
        }
      }

      // Partien gehen über mehrere Runden, sonst würde Schritt 18 kaum geprüft.
      expect(totalRounds).toBeGreaterThan(2 * GAMES_PER_CONFIG);
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

    expect(playGame(config, 42).end).toEqual(playGame(config, 42).end);
    expect(playGame(config, 42).end).not.toEqual(playGame(config, 43).end);
  });
});
