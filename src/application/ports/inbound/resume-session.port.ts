import type { Seat } from '../../../domain/rules/parties';
import type { ConnectionId, RoomId, SessionId } from '../../model/room';
import type { ServiceFailure } from './service-error';

export interface ResumeSessionCommand {
  readonly sessionId: SessionId;
  readonly connectionId: ConnectionId;
}

export interface SessionResumed {
  readonly ok: true;
  readonly roomId: RoomId;
  readonly seat: Seat;
  /** Verbindung, die den Sitz bis eben hielt; der Adapter trennt sie. */
  readonly replacedConnectionId: ConnectionId | null;
}

export interface ResumeSessionPort {
  resumeSession(command: ResumeSessionCommand): Promise<SessionResumed | ServiceFailure>;
}
