import type { GameConfig } from '../../domain/config/game-config';
import type { Seat } from '../../domain/rules/parties';
import type { GameState } from '../../domain/state/game-state';
import type { SeatInfo } from '../projection/player-view';

export type RoomId = string;
export type SessionId = string;
/** Kennung einer Netzwerkverbindung (z. B. Socket-ID); vergibt der Inbound-Adapter. */
export type ConnectionId = string;

export interface RoomSeat {
  readonly sessionId: SessionId;
  readonly displayName: string;
  /** null, solange der Sitz getrennt ist. */
  readonly connectionId: ConnectionId | null;
}

/** Sitzungsdaten liegen hier und nicht im GameState, damit die Engine frei davon bleibt. */
export interface Room {
  readonly id: RoomId;
  readonly config: GameConfig;
  /** Nach Sitz indiziert; freie Sitze sind null. */
  readonly seats: readonly (RoomSeat | null)[];
  /** null bis zum Spielstart. */
  readonly game: GameState | null;
  /** Grundlage für das Aufräumen verwaister Räume (Schritt 23). */
  readonly lastActivityAt: number;
}

export function findSession(
  room: Room,
  sessionId: SessionId,
): { readonly seat: Seat; readonly occupant: RoomSeat } | null {
  for (const [seat, occupant] of room.seats.entries()) {
    if (occupant?.sessionId === sessionId) return { seat, occupant };
  }
  return null;
}

export function withSeat(room: Room, seat: Seat, occupant: RoomSeat | null): Room {
  return {
    ...room,
    seats: room.seats.map((current, index) => (index === seat ? occupant : current)),
  };
}

export function isFull(room: Room): boolean {
  return room.seats.every((occupant) => occupant !== null);
}

export function isEmpty(room: Room): boolean {
  return room.seats.every((occupant) => occupant === null);
}

export function seatInfoOf(occupant: RoomSeat): SeatInfo {
  return { displayName: occupant.displayName, connected: occupant.connectionId !== null };
}
