import { describe, expect, it } from 'vitest';
import type { Room } from '../../application/model/room';
import { NO_SPECIAL_RULES } from '../../domain/config/game-config';
import { createInMemoryRoomRepository } from './in-memory-room-repository';

const room: Room = {
  id: 'ABCDEF',
  config: { playerCount: 3, deckSize: 40, specialRules: NO_SPECIAL_RULES, mode: 'classic' },
  seats: [null, { sessionId: 's-1', displayName: 'Ben', connectionId: null }, null],
  game: null,
  lastActivityAt: 0,
};

describe('createInMemoryRoomRepository', () => {
  it('speichert, findet und löscht Räume', async () => {
    const repository = createInMemoryRoomRepository();
    await repository.save(room);

    await expect(repository.get('ABCDEF')).resolves.toBe(room);
    await expect(repository.findBySession('s-1')).resolves.toBe(room);
    await expect(repository.findBySession('fremd')).resolves.toBeUndefined();

    await repository.delete('ABCDEF');
    await expect(repository.get('ABCDEF')).resolves.toBeUndefined();
    await expect(repository.findBySession('s-1')).resolves.toBeUndefined();
  });
});
