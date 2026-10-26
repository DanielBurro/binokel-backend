import type { GameEvent } from '../../../domain/state/intents';
import type { ConnectionId, RoomId } from '../../model/room';
import type { PlayerView } from '../../projection/player-view';
import type { RoomView } from '../../projection/room-view';

export interface GameEventBatch {
  /** Version des Zustands nach den Ereignissen. */
  readonly version: number;
  readonly events: readonly GameEvent[];
}

export interface GameBroadcasterPort {
  /** Meldet die Verbindung für die öffentlichen Nachrichten des Raums an. */
  subscribe(connectionId: ConnectionId, roomId: RoomId): void;
  unsubscribe(connectionId: ConnectionId, roomId: RoomId): void;
  /** Öffentlich an alle angemeldeten Verbindungen des Raums. */
  roomState(roomId: RoomId, view: RoomView): void;
  gameEvents(roomId: RoomId, batch: GameEventBatch): void;
  /** Privat: geht nur an genau diese Verbindung (FA-05). */
  playerView(connectionId: ConnectionId, view: PlayerView): void;
}
