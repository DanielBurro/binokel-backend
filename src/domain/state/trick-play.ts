import type { Card, CardId } from '../cards/card';
import type { GameConfig, PlayerCount } from '../config/game-config';
import { nextSeat, type Seat } from '../rules/parties';
import { leadingPlay, legalCards } from '../rules/trick';
import type { RoundState } from './game-state';
import { fail, type GameEvent, type IntentFailure } from './intents';

export type TrickResult =
  | { readonly ok: true; readonly round: RoundState; readonly events: readonly GameEvent[] }
  | IntentFailure;

/**
 * Wer als Nächstes legt: Den ersten Stich spielt die Vorhand aus, jeden weiteren der Gewinner
 * des vorherigen (Studienarbeit, Phase 6). Danach geht es in Spielrichtung weiter.
 */
export function nextPlayer(round: RoundState, playerCount: PlayerCount): Seat {
  const { tricks, trick, forehand } = round;
  let seat = tricks.length === 0 ? forehand : tricks[tricks.length - 1].winner;
  for (let played = 0; played < trick.length; played++) seat = nextSeat(seat, playerCount);
  return seat;
}

/** Karten der Hand, die Farb-, Stich- und Trumpfzwang im laufenden Stich erlauben. */
export function playableCards(round: RoundState, seat: Seat): Card[] {
  const { declaration } = round;
  if (declaration === null) return [];
  return legalCards(round.hands[seat], round.trick, declaration.trump);
}

/**
 * Der Sitz am Zug legt eine Karte. Mit der letzten Karte eines Stichs entscheidet der
 * Stichentscheid den Gewinner, der Stich wandert zu den abgeschlossenen. Die Phase prüft der
 * Aufrufer, ebenso, ob danach alle Hände leer sind.
 */
export function playCard(
  round: RoundState,
  seat: Seat,
  cardId: CardId,
  config: GameConfig,
): TrickResult {
  const { declaration } = round;
  if (declaration === null) return fail('WRONG_PHASE');
  if (seat !== nextPlayer(round, config.playerCount)) return fail('NOT_YOUR_TURN');
  const card = round.hands[seat].find((own) => own.id === cardId);
  if (card === undefined) return fail('CARD_NOT_IN_HAND');
  if (!playableCards(round, seat).includes(card)) return fail('CARD_NOT_ALLOWED');

  const hands = round.hands.map((hand, index) =>
    index === seat ? hand.filter((own) => own !== card) : hand,
  );
  const plays = [...round.trick, { seat, card }];
  const played: GameEvent = { type: 'cardPlayed', seat, card };
  if (plays.length < config.playerCount) {
    return { ok: true, round: { ...round, hands, trick: plays }, events: [played] };
  }

  const winner = leadingPlay(plays, declaration.trump).seat;
  return {
    ok: true,
    round: { ...round, hands, trick: [], tricks: [...round.tricks, { plays, winner }] },
    events: [played, { type: 'trickWon', winner }],
  };
}
