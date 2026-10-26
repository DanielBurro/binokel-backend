import { describe, expect, it } from 'vitest';
import { NO_SPECIAL_RULES } from '../../domain/config/game-config';
import { createFakeClock, createFakeRoomRepository } from '../../test/fakes';
import type { Room } from '../model/room';
import { createRoomStore } from './room-store';

const room: Room = {
  id: 'ABCDEF',
  config: { playerCount: 3, deckSize: 40, specialRules: NO_SPECIAL_RULES, mode: 'classic' },
  seats: [{ sessionId: 's-0', displayName: 'Anna', connectionId: 'c-0' }, null, null],
  game: null,
  lastActivityAt: 0,
};

function setup() {
  const repository = createFakeRoomRepository();
  const clock = createFakeClock(5_000);
  return { repository, clock, store: createRoomStore(repository, clock) };
}

describe('createRoomStore', () => {
  it('speichert mit dem aktuellen Zeitstempel', async () => {
    const { repository, clock, store } = setup();
    clock.advance(250);

    const saved = await store.save(room);

    expect(saved.lastActivityAt).toBe(5_250);
    expect(repository.rooms.get(room.id)).toBe(saved);
  });

  it('übergibt Raum, Sitz und Belegung der Session', async () => {
    const { store } = setup();
    await store.save(room);

    const result = await store.exclusiveBySession('s-0', async (found, seat, occupant) => ({
      id: found.id,
      seat,
      occupant,
    }));

    expect(result).toEqual({ id: room.id, seat: 0, occupant: room.seats[0] });
  });

  it('meldet SESSION_NOT_FOUND für unbekannte Sessions', async () => {
    const { store } = setup();
    await store.save(room);

    await expect(store.exclusiveBySession('fremd', async () => 'nie')).resolves.toEqual({
      ok: false,
      code: 'SESSION_NOT_FOUND',
    });
  });

  it('prüft die Session unter der Sperre erneut', async () => {
    const { store } = setup();
    await store.save(room);

    const deleting = store.exclusive(room.id, () => store.delete(room.id));
    const result = store.exclusiveBySession('s-0', async () => 'nie');
    await deleting;

    await expect(result).resolves.toEqual({ ok: false, code: 'SESSION_NOT_FOUND' });
  });
});
