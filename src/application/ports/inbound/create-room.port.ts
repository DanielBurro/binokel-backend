import type { GameConfig } from '../../../domain/config/game-config';
import type { Seat } from '../../../domain/rules/parties';
import type { ConnectionId, RoomId, SessionId } from '../../model/room';
import type { ServiceFailure } from './service-error';

export interface CreateRoomCommand {
  readonly displayName: string;
  readonly config: GameConfig;
  readonly connectionId: ConnectionId;
}

export interface RoomJoined {
  readonly ok: true;
  readonly roomId: RoomId;
  readonly seat: Seat;
  /** Berechtigt zum Wiederaufnehmen des Sitzes; nur der Spieler selbst erhält sie. */
  readonly sessionId: SessionId;
}

export type RoomJoinedResult = RoomJoined | ServiceFailure;

export interface CreateRoomPort {
  createRoom(command: CreateRoomCommand): Promise<RoomJoinedResult>;
}
