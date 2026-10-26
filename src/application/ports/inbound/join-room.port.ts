import type { ConnectionId, RoomId } from '../../model/room';
import type { RoomJoinedResult } from './create-room.port';

export interface JoinRoomCommand {
  readonly roomId: RoomId;
  readonly displayName: string;
  readonly connectionId: ConnectionId;
}

export interface JoinRoomPort {
  joinRoom(command: JoinRoomCommand): Promise<RoomJoinedResult>;
}
