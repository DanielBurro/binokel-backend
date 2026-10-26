import type { SessionId } from '../../model/room';
import type { ServiceFailure } from './service-error';

export interface LeaveRoomCommand {
  readonly sessionId: SessionId;
}

export interface LeaveRoomPort {
  /** In der Lobby wird der Sitz frei, in einem laufenden Spiel bricht es für alle ab. */
  leaveRoom(command: LeaveRoomCommand): Promise<{ readonly ok: true } | ServiceFailure>;
}
