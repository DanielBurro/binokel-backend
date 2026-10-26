import type { GameConfig } from '../../domain/config/game-config';
import { seatInfoOf, type Room, type RoomId } from '../model/room';
import type { SeatInfo } from './player-view';

/** Öffentliche Sicht der Lobby bis zum Spielstart; enthält keine Session-IDs. */
export interface RoomView {
  readonly roomId: RoomId;
  readonly config: GameConfig;
  /** Freie Sitze sind null. */
  readonly seats: readonly (SeatInfo | null)[];
}

export function projectRoom(room: Room): RoomView {
  return {
    roomId: room.id,
    config: { ...room.config, specialRules: { ...room.config.specialRules } },
    seats: room.seats.map((occupant) => (occupant === null ? null : seatInfoOf(occupant))),
  };
}
