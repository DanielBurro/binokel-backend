import type { RoomId, SessionId } from '../../model/room';

export interface IdGeneratorPort {
  /** Kurz und zum Abtippen gedacht; Eindeutigkeit prüft der RoomService. */
  roomId(): RoomId;
  /** Nicht erratbar, denn wer sie kennt, übernimmt den Sitz. */
  sessionId(): SessionId;
}
