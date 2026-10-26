import type { Room, RoomId, SessionId } from '../../model/room';

/** Asynchron, damit eine spätere persistente Implementierung die Services nicht ändert. */
export interface RoomRepositoryPort {
  get(roomId: RoomId): Promise<Room | undefined>;
  findBySession(sessionId: SessionId): Promise<Room | undefined>;
  save(room: Room): Promise<void>;
  delete(roomId: RoomId): Promise<void>;
}
