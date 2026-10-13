import type { PlayerCount } from '../config/game-config';

export type Seat = number;
export type PartyId = number;

export function assertSeat(seat: Seat, playerCount: PlayerCount): void {
  if (!Number.isInteger(seat) || seat < 0 || seat >= playerCount) {
    throw new RangeError(`Ungültiger Sitz ${seat} bei ${playerCount} Spielern`);
  }
}

/** 3 Spieler: jeder für sich; 4 Spieler: Sitz p und (p+2) mod 4 bilden eine Partei. */
export function partyOf(seat: Seat, playerCount: PlayerCount): PartyId {
  assertSeat(seat, playerCount);
  return playerCount === 4 ? seat % 2 : seat;
}

export function partyCount(playerCount: PlayerCount): number {
  return playerCount === 4 ? 2 : 3;
}
