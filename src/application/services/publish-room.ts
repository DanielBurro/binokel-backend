import type { GameEvent } from '../../domain/state/intents';
import { seatInfoOf, type Room } from '../model/room';
import type { GameBroadcasterPort } from '../ports/outbound/game-broadcaster.port';
import { projectStateFor } from '../projection/project-state';
import { projectRoom } from '../projection/room-view';

/**
 * Lobby: `room:state` an alle. Ab Spielstart erhält jeder verbundene Sitz seine eigene
 * `PlayerView`, danach folgen die öffentlichen Ereignisse.
 */
export function publishRoom(
  broadcaster: GameBroadcasterPort,
  room: Room,
  events: readonly GameEvent[] = [],
): void {
  const { game } = room;
  if (game === null) {
    broadcaster.roomState(room.id, projectRoom(room));
    return;
  }

  const seats = room.seats.map((occupant, seat) => {
    if (occupant === null) throw new Error(`Sitz ${seat} ist trotz Spielstart frei`);
    return occupant;
  });
  const infos = seats.map(seatInfoOf);
  seats.forEach(({ connectionId }, seat) => {
    if (connectionId !== null) {
      broadcaster.playerView(connectionId, projectStateFor(game, seat, infos));
    }
  });
  if (events.length > 0) {
    broadcaster.gameEvents(room.id, { version: game.version, events });
  }
}
