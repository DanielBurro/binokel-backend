import type { ConnectionId, SessionId } from '../../model/room';

export interface DisconnectCommand {
  readonly sessionId: SessionId;
  readonly connectionId: ConnectionId;
}

export interface DisconnectPort {
  /** Markiert den Sitz als getrennt, sofern er noch an dieser Verbindung hängt. */
  disconnect(command: DisconnectCommand): Promise<void>;
}
