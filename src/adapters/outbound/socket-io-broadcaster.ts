import type { RoomId } from '../../application/model/room';
import type { GameBroadcasterPort } from '../../application/ports/outbound/game-broadcaster.port';
import { SERVER_EVENTS } from '../inbound/websocket/protocol';
import type { BinokelServer } from '../inbound/websocket/socket-io-server';

/** Socket.IO-Raum je Spielraum; das Präfix trennt ihn von den Räumen der Socket-IDs. */
export function channelOf(roomId: RoomId): string {
  return `room:${roomId}`;
}

/**
 * Jeder Socket steckt automatisch in einem Socket.IO-Raum mit seiner eigenen ID. Private Zustände
 * gehen nur dorthin, öffentliche Nachrichten an den Kanal des Spielraums.
 */
export function createSocketIoBroadcaster(io: BinokelServer): GameBroadcasterPort {
  return {
    subscribe(connectionId, roomId) {
      io.in(connectionId).socketsJoin(channelOf(roomId));
    },
    unsubscribe(connectionId, roomId) {
      io.in(connectionId).socketsLeave(channelOf(roomId));
    },
    roomState(roomId, view) {
      io.to(channelOf(roomId)).emit(SERVER_EVENTS.roomState.name, view);
    },
    gameEvents(roomId, batch) {
      io.to(channelOf(roomId)).emit(SERVER_EVENTS.gameEvents.name, batch);
    },
    playerView(connectionId, view) {
      io.to(connectionId).emit(SERVER_EVENTS.gameState.name, view);
    },
  };
}
