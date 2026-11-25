import { buildDeck } from '../../domain/cards/deck';
import { applyIntent } from '../../domain/state/apply-intent';
import { createGame, type AbortReason, type GameState } from '../../domain/state/game-state';
import { SYSTEM, type SystemIntent } from '../../domain/state/intents';
import { everyoneReady } from '../../domain/state/next-round';
import type { Room } from '../model/room';
import type { ExecuteMovePort, MoveExecuted } from '../ports/inbound/execute-move.port';
import { failure, type ServiceFailure } from '../ports/inbound/service-error';
import type { GameBroadcasterPort } from '../ports/outbound/game-broadcaster.port';
import type { ShufflerPort } from '../ports/outbound/shuffler.port';
import { publishRoom } from './publish-room';
import type { RoomStore } from './room-store';

/**
 * Der GameService ist der einzige Erzeuger von System-Intents: `startRound` beim Spielstart und
 * sobald alle die nächste Runde bestätigt haben, `abortGame` beim Verlassen eines Spiels.
 */
export interface GameService extends ExecuteMovePort {
  /** Teilt die erste Runde aus. Nur unter der Sperre des Raums aufrufen. */
  startGame(room: Room): Promise<Room>;
  /** Beendet ein laufendes Spiel für alle. Nur unter der Sperre des Raums aufrufen. */
  abortGame(room: Room, reason: AbortReason): Promise<Room>;
}

export interface GameServiceDeps {
  readonly store: RoomStore;
  readonly broadcaster: GameBroadcasterPort;
  readonly shuffler: ShufflerPort;
}

export function createGameService({ store, broadcaster, shuffler }: GameServiceDeps): GameService {
  async function applySystemIntent(
    room: Room,
    game: GameState,
    intent: SystemIntent,
  ): Promise<Room> {
    const result = applyIntent(game, SYSTEM, intent);
    if (!result.ok) {
      throw new Error(`System-Intent ${intent.type} in Raum ${room.id} abgelehnt: ${result.code}`);
    }
    const saved = await store.save({ ...room, game: result.state });
    publishRoom(broadcaster, saved, result.events);
    return saved;
  }

  return {
    executeMove({ sessionId, expectedVersion, intent }) {
      return store.exclusiveBySession(
        sessionId,
        async (room, seat): Promise<MoveExecuted | ServiceFailure> => {
          const { game } = room;
          if (game === null) return failure('WRONG_PHASE');
          if (expectedVersion !== game.version) return failure('STALE_STATE');

          const result = applyIntent(game, seat, intent);
          if (!result.ok) return failure(result.code);

          const saved = await store.save({ ...room, game: result.state });
          publishRoom(broadcaster, saved, result.events);
          if (!everyoneReady(result.state)) return { ok: true, version: result.state.version };

          // Alle haben die nächste Runde bestätigt: frisch mischen und austeilen. Das Ack nennt
          // die Version nach dem Austeilen, damit der nächste Zug darauf aufsetzen kann.
          const dealt = await applySystemIntent(saved, result.state, {
            type: 'startRound',
            shuffledDeck: shuffler.shuffle(buildDeck(room.config.deckSize)),
          });
          return { ok: true, version: dealt.game!.version };
        },
      );
    },

    startGame(room) {
      if (room.game !== null) {
        throw new Error(`Spiel in Raum ${room.id} läuft bereits`);
      }
      // Studienarbeit FA-07: Den Geber der ersten Runde bestimmt der Zufall. Gemischt wird über
      // denselben Port wie das Blatt, also kryptografisch.
      const seats = Array.from({ length: room.config.playerCount }, (_, seat) => seat);
      const [firstDealer] = shuffler.shuffle(seats);
      const game = createGame(room.config, firstDealer);
      const shuffledDeck = shuffler.shuffle(buildDeck(room.config.deckSize));
      return applySystemIntent(room, game, { type: 'startRound', shuffledDeck });
    },

    async abortGame(room, reason) {
      if (room.game === null || room.game.phase === 'terminated') return room;
      return applySystemIntent(room, room.game, { type: 'abortGame', reason });
    },
  };
}
