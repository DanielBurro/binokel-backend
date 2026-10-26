import { findSession, type Room, type RoomId } from '../application/model/room';
import type { ClockPort } from '../application/ports/outbound/clock.port';
import type {
  GameBroadcasterPort,
  GameEventBatch,
} from '../application/ports/outbound/game-broadcaster.port';
import type { IdGeneratorPort } from '../application/ports/outbound/id-generator.port';
import type { RoomRepositoryPort } from '../application/ports/outbound/room-repository.port';
import type { ShufflerPort } from '../application/ports/outbound/shuffler.port';
import type { PlayerView } from '../application/projection/player-view';
import type { RoomView } from '../application/projection/room-view';
import { createGameService } from '../application/services/game-service';
import { createRoomService } from '../application/services/room-service';
import { createRoomStore } from '../application/services/room-store';

/** Testhilfen ohne Netzwerk; nicht Teil des Builds. */

export type BroadcastMessage =
  | { readonly kind: 'subscribe'; readonly connectionId: string; readonly roomId: RoomId }
  | { readonly kind: 'unsubscribe'; readonly connectionId: string; readonly roomId: RoomId }
  | { readonly kind: 'roomState'; readonly roomId: RoomId; readonly view: RoomView }
  | { readonly kind: 'gameEvents'; readonly roomId: RoomId; readonly batch: GameEventBatch }
  | { readonly kind: 'playerView'; readonly connectionId: string; readonly view: PlayerView };

export function createRecordingBroadcaster() {
  const messages: BroadcastMessage[] = [];
  const broadcaster: GameBroadcasterPort = {
    subscribe: (connectionId, roomId) => messages.push({ kind: 'subscribe', connectionId, roomId }),
    unsubscribe: (connectionId, roomId) =>
      messages.push({ kind: 'unsubscribe', connectionId, roomId }),
    roomState: (roomId, view) => messages.push({ kind: 'roomState', roomId, view }),
    gameEvents: (roomId, batch) => messages.push({ kind: 'gameEvents', roomId, batch }),
    playerView: (connectionId, view) => messages.push({ kind: 'playerView', connectionId, view }),
  };
  return { broadcaster, messages };
}

export function createFakeRoomRepository(): RoomRepositoryPort & {
  readonly rooms: Map<RoomId, Room>;
} {
  const rooms = new Map<RoomId, Room>();
  return {
    rooms,
    async get(roomId) {
      return rooms.get(roomId);
    },
    async findBySession(sessionId) {
      return [...rooms.values()].find((room) => findSession(room, sessionId) !== null);
    },
    async save(room) {
      rooms.set(room.id, room);
    },
    async delete(roomId) {
      rooms.delete(roomId);
    },
  };
}

/** Liefert zuerst die vorgegebenen Raum-IDs, danach ROOM01, ROOM02, … */
export function createSequentialIds(roomIds: readonly string[] = []): IdGeneratorPort {
  const queue = [...roomIds];
  let rooms = 0;
  let sessions = 0;
  return {
    roomId: () => queue.shift() ?? `ROOM${String(++rooms).padStart(2, '0')}`,
    sessionId: () => `session-${++sessions}`,
  };
}

export function createFakeClock(start = 1_000): ClockPort & { advance(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

/** Mischt nicht; so ist die Kartenverteilung im Test vorhersagbar. */
export const identityShuffler: ShufflerPort = { shuffle: (items) => [...items] };

export function createTestServices(roomIds: readonly string[] = []) {
  const repository = createFakeRoomRepository();
  const clock = createFakeClock();
  const { broadcaster, messages } = createRecordingBroadcaster();
  const store = createRoomStore(repository, clock);
  const games = createGameService({ store, broadcaster, shuffler: identityShuffler });
  const rooms = createRoomService({ store, ids: createSequentialIds(roomIds), broadcaster, games });
  return { repository, clock, messages, store, games, rooms };
}
