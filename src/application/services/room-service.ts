import { validateGameConfig } from '../../domain/config/game-config';
import type { Seat } from '../../domain/rules/parties';
import {
  isEmpty,
  isFull,
  withSeat,
  type ConnectionId,
  type Room,
  type RoomId,
} from '../model/room';
import type {
  CreateRoomPort,
  RoomJoined,
  RoomJoinedResult,
} from '../ports/inbound/create-room.port';
import type { DisconnectPort } from '../ports/inbound/disconnect.port';
import type { JoinRoomPort } from '../ports/inbound/join-room.port';
import type { LeaveRoomPort } from '../ports/inbound/leave-room.port';
import type { ResumeSessionPort, SessionResumed } from '../ports/inbound/resume-session.port';
import { failure } from '../ports/inbound/service-error';
import type { GameBroadcasterPort } from '../ports/outbound/game-broadcaster.port';
import type { IdGeneratorPort } from '../ports/outbound/id-generator.port';
import type { GameService } from './game-service';
import { publishRoom } from './publish-room';
import type { RoomStore } from './room-store';

/** Bei einem kurzen Alphabet sind Kollisionen möglich, aber selten. */
export const MAX_ROOM_ID_ATTEMPTS = 20;

export type RoomService = CreateRoomPort &
  JoinRoomPort &
  ResumeSessionPort &
  LeaveRoomPort &
  DisconnectPort;

export interface RoomServiceDeps {
  readonly store: RoomStore;
  readonly ids: IdGeneratorPort;
  readonly broadcaster: GameBroadcasterPort;
  readonly games: GameService;
}

/** Raum-IDs werden ohne Rücksicht auf Groß- und Kleinschreibung angenommen. */
export function normalizeRoomId(roomId: string): RoomId {
  return roomId.trim().toUpperCase();
}

/**
 * Lobby und Sitzungen (FA-01/02). Autorisiert ist, wer die Session-ID seines Sitzes kennt,
 * Benutzerkonten gibt es nicht.
 */
export function createRoomService({
  store,
  ids,
  broadcaster,
  games,
}: RoomServiceDeps): RoomService {
  /** Belegt den Sitz und startet das Spiel, sobald der Raum voll ist. */
  async function seatPlayer(
    room: Room,
    seat: Seat,
    displayName: string,
    connectionId: ConnectionId,
  ): Promise<RoomJoined> {
    const sessionId = ids.sessionId();
    const saved = await store.save(withSeat(room, seat, { sessionId, displayName, connectionId }));
    broadcaster.subscribe(connectionId, saved.id);
    publishRoom(broadcaster, saved);
    if (isFull(saved)) {
      await games.startGame(saved);
    }
    return { ok: true, roomId: saved.id, seat, sessionId };
  }

  return {
    async createRoom({ displayName, config, connectionId }) {
      const validation = validateGameConfig(config);
      if (!validation.ok) return failure('INVALID_CONFIG', validation.errors);

      for (let attempt = 0; attempt < MAX_ROOM_ID_ATTEMPTS; attempt++) {
        const roomId = ids.roomId();
        const created = await store.exclusive(roomId, async (existing) => {
          if (existing !== undefined) return null;
          const room: Room = {
            id: roomId,
            config,
            seats: Array.from({ length: config.playerCount }, () => null),
            game: null,
            lastActivityAt: 0,
          };
          return seatPlayer(room, 0, displayName, connectionId);
        });
        if (created !== null) return created;
      }
      throw new Error(`Keine freie Raum-ID nach ${MAX_ROOM_ID_ATTEMPTS} Versuchen`);
    },

    joinRoom({ roomId, displayName, connectionId }) {
      return store.exclusive(normalizeRoomId(roomId), async (room): Promise<RoomJoinedResult> => {
        if (room === undefined) return failure('ROOM_NOT_FOUND');
        // Sitzvergabe nach Beitrittsreihenfolge; ein in der Lobby freigewordener Sitz zuerst.
        const seat = room.game === null ? room.seats.indexOf(null) : -1;
        if (seat === -1) return failure('ROOM_FULL');
        return seatPlayer(room, seat, displayName, connectionId);
      });
    },

    resumeSession({ sessionId, connectionId }) {
      return store.exclusiveBySession(
        sessionId,
        async (room, seat, occupant): Promise<SessionResumed> => {
          const replaced = occupant.connectionId === connectionId ? null : occupant.connectionId;
          if (replaced !== null) broadcaster.unsubscribe(replaced, room.id);

          const saved = await store.save(withSeat(room, seat, { ...occupant, connectionId }));
          broadcaster.subscribe(connectionId, saved.id);
          // Alle sehen den Sitz wieder verbunden, der Zurückgekehrte erhält den vollen Zustand.
          publishRoom(broadcaster, saved);
          return { ok: true, roomId: saved.id, seat, replacedConnectionId: replaced };
        },
      );
    },

    leaveRoom({ sessionId }) {
      return store.exclusiveBySession(sessionId, async (room, seat, occupant) => {
        if (occupant.connectionId !== null) broadcaster.unsubscribe(occupant.connectionId, room.id);

        if (room.game === null) {
          const vacated = withSeat(room, seat, null);
          if (isEmpty(vacated)) {
            await store.delete(room.id);
          } else {
            publishRoom(broadcaster, await store.save(vacated));
          }
        } else {
          // Der Sitz bleibt belegt, damit die übrigen Spieler das beendete Spiel weiter sehen.
          const saved = await store.save(withSeat(room, seat, { ...occupant, connectionId: null }));
          if (room.game.phase === 'terminated') {
            publishRoom(broadcaster, saved);
          } else {
            await games.abortGame(saved, 'PLAYER_LEFT');
          }
        }
        return { ok: true as const };
      });
    },

    async disconnect({ sessionId, connectionId }) {
      await store.exclusiveBySession(sessionId, async (room, seat, occupant) => {
        // Hat der Spieler den Sitz schon über eine neue Verbindung übernommen, bleibt er verbunden.
        if (occupant.connectionId !== connectionId) return;
        broadcaster.unsubscribe(connectionId, room.id);
        publishRoom(
          broadcaster,
          await store.save(withSeat(room, seat, { ...occupant, connectionId: null })),
        );
      });
    },
  };
}
