import type { Seat } from '../../domain/rules/parties';
import { findSession, type Room, type RoomId, type RoomSeat, type SessionId } from '../model/room';
import { failure, type ServiceFailure } from '../ports/inbound/service-error';
import type { ClockPort } from '../ports/outbound/clock.port';
import type { RoomRepositoryPort } from '../ports/outbound/room-repository.port';
import { createKeyedQueue, type KeyedQueue } from './keyed-queue';

/**
 * Zugriff auf Räume mit einer Sperre je Raum (NFA-04). Aufgaben laden den Raum unter der Sperre
 * frisch und dürfen dieselbe Sperre nicht erneut anfordern.
 */
export interface RoomStore {
  exclusive<T>(roomId: RoomId, task: (room: Room | undefined) => Promise<T>): Promise<T>;
  /** SESSION_NOT_FOUND, wenn die Session zu keinem Sitz (mehr) gehört. */
  exclusiveBySession<T>(
    sessionId: SessionId,
    task: (room: Room, seat: Seat, occupant: RoomSeat) => Promise<T>,
  ): Promise<T | ServiceFailure>;
  /** Speichert mit aktuellem Zeitstempel und liefert den gespeicherten Raum. */
  save(room: Room): Promise<Room>;
  delete(roomId: RoomId): Promise<void>;
}

export function createRoomStore(
  repository: RoomRepositoryPort,
  clock: ClockPort,
  queue: KeyedQueue = createKeyedQueue(),
): RoomStore {
  const exclusive: RoomStore['exclusive'] = (roomId, task) =>
    queue.run(roomId, async () => task(await repository.get(roomId)));

  return {
    exclusive,
    async exclusiveBySession(sessionId, task) {
      const found = await repository.findBySession(sessionId);
      if (found === undefined) return failure('SESSION_NOT_FOUND');
      // Bis die Sperre greift, kann sich der Raum geändert haben, daher erneut prüfen.
      return exclusive(found.id, async (room) => {
        const session = room === undefined ? null : findSession(room, sessionId);
        if (room === undefined || session === null) return failure('SESSION_NOT_FOUND');
        return task(room, session.seat, session.occupant);
      });
    },
    async save(room) {
      const stamped = { ...room, lastActivityAt: clock.now() };
      await repository.save(stamped);
      return stamped;
    },
    delete: (roomId) => repository.delete(roomId),
  };
}
