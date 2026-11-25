import type { GameConfig, PlayerCount } from '../config/game-config';
import { bestMelds } from '../melds/best-melds';
import { meldPoints, type Meld, type MeldId } from '../melds/meld';
import { nextSeat, partyOf, type Seat } from '../rules/parties';
import type { RoundState } from './game-state';
import { fail, type GameEvent, type IntentFailure } from './intents';

export type MeldResult =
  | { readonly ok: true; readonly round: RoundState; readonly events: readonly GameEvent[] }
  | IntentFailure;

/** Beim Abgehen meldet die Partei des Spielmachers nicht, bei 4 Spielern also auch sein Partner. */
export function mayMeld(round: RoundState, seat: Seat, playerCount: PlayerCount): boolean {
  const { declarer, declaration } = round;
  if (declarer === null || declaration === null) return false;
  if (declaration.mode === 'play') return true;
  return partyOf(seat, playerCount) !== partyOf(declarer, playerCount);
}

/**
 * Wer als Nächstes meldet: ab dem Spielmacher in Spielrichtung der erste meldeberechtigte Sitz,
 * der noch nicht gemeldet hat. null, sobald alle durch sind.
 */
export function nextMelder(round: RoundState, playerCount: PlayerCount): Seat | null {
  const { declarer } = round;
  if (declarer === null) return null;
  let seat = declarer;
  for (let step = 0; step < playerCount; step++) {
    if (mayMeld(round, seat, playerCount) && round.melds[seat] === null) return seat;
    seat = nextSeat(seat, playerCount);
  }
  return null;
}

/** Vorschlag des Servers: die punktehöchste gültige Auswahl aus der Hand des Sitzes. */
export function offeredMelds(round: RoundState, seat: Seat, config: GameConfig): Meld[] {
  const { declaration } = round;
  if (declaration === null) return [];
  return bestMelds(round.hands[seat], declaration.trump, config.deckSize);
}

/**
 * Der Sitz meldet den Vorschlag oder einen Teil davon (Entscheidung vom 25.11.2026: Vorschlag
 * und Abwählen). Weil der Vorschlag je Gruppe kartendisjunkt ist, ist jede Teilmenge gültig.
 * Die Phase prüft der Aufrufer.
 */
export function submitMelds(
  round: RoundState,
  seat: Seat,
  meldIds: readonly MeldId[],
  config: GameConfig,
): MeldResult {
  if (seat !== nextMelder(round, config.playerCount)) return fail('NOT_YOUR_TURN');
  const chosen = new Set(meldIds);
  if (chosen.size !== meldIds.length) return fail('DUPLICATE_MELDS');
  const offered = offeredMelds(round, seat, config);
  if (meldIds.some((id) => !offered.some((meld) => meld.id === id))) {
    return fail('MELD_NOT_OFFERED');
  }

  const melds = offered.filter((meld) => chosen.has(meld.id));
  const points = meldPoints(melds);
  return {
    ok: true,
    round: {
      ...round,
      melds: round.melds.map((other, index) => (index === seat ? { melds, points } : other)),
    },
    events: [{ type: 'meldsSubmitted', seat, melds, points }],
  };
}
