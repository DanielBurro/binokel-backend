import type http from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { SessionId } from '../../../application/model/room';
import type { GameEventBatch } from '../../../application/ports/outbound/game-broadcaster.port';
import type { PlayerView } from '../../../application/projection/player-view';
import type { RoomView } from '../../../application/projection/room-view';
import type { Env } from '../../../config/env';
import type { CLIENT_EVENTS, SERVER_EVENTS } from './protocol';

/** Obergrenze je Nachricht; die Payloads des Protokolls sind wenige hundert Byte groß. */
export const MAX_MESSAGE_BYTES = 16 * 1024;

export type ClientEventName = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS]['name'];

/** Payload und Ack sind unbekannt, bis der Adapter sie gegen das Protokoll geprüft hat. */
export type ClientToServerEvents = Record<
  ClientEventName,
  (payload: unknown, ack: unknown) => void
>;

/** Typen aus der Application; protocol.ts prüft per `satisfies`, dass die Schemas passen. */
interface ServerEventPayloads {
  roomState: RoomView;
  gameState: PlayerView;
  gameEvents: GameEventBatch;
}

export type ServerToClientEvents = {
  [K in keyof typeof SERVER_EVENTS as (typeof SERVER_EVENTS)[K]['name']]: (
    payload: ServerEventPayloads[K],
  ) => void;
};

export interface SocketData {
  /** Sitzung, an die der Socket gebunden ist; null vor Beitritt und nach Verlassen. */
  sessionId: SessionId | null;
}

export type BinokelServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
export type BinokelSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export function createSocketIoServer(
  httpServer: http.Server,
  { corsOrigins }: Pick<Env, 'corsOrigins'>,
): BinokelServer {
  return new Server(httpServer, {
    cors: { origin: corsOrigins },
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
  });
}
