import type { PlayerIntent } from '../../../domain/state/intents';
import type { SessionId } from '../../model/room';
import type { ServiceFailure } from './service-error';

export interface ExecuteMoveCommand {
  readonly sessionId: SessionId;
  /** Muss der aktuellen `version` entsprechen, sonst STALE_STATE (NFA-04). */
  readonly expectedVersion: number;
  readonly intent: PlayerIntent;
}

export interface MoveExecuted {
  readonly ok: true;
  readonly version: number;
}

export interface ExecuteMovePort {
  executeMove(command: ExecuteMoveCommand): Promise<MoveExecuted | ServiceFailure>;
}
