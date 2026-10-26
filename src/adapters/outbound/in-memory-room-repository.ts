import { findSession, type Room, type RoomId } from '../../application/model/room';
import type { RoomRepositoryPort } from '../../application/ports/outbound/room-repository.port';

/** Zustand rein im Arbeitsspeicher, wie im Architekturkapitel festgelegt. */
export function createInMemoryRoomRepository(): RoomRepositoryPort {
  const rooms = new Map<RoomId, Room>();
  return {
    async get(roomId) {
      return rooms.get(roomId);
    },
    async findBySession(sessionId) {
      for (const room of rooms.values()) {
        if (findSession(room, sessionId) !== null) return room;
      }
      return undefined;
    },
    async save(room) {
      rooms.set(room.id, room);
    },
    async delete(roomId) {
      rooms.delete(roomId);
    },
  };
}
