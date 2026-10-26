import { describe, expect, it } from 'vitest';
import { ROOM_ID_ALPHABET, ROOM_ID_LENGTH, createCryptoIdGenerator } from './crypto-id-generator';

describe('createCryptoIdGenerator', () => {
  it('erzeugt kurze Raum-IDs aus dem unverwechselbaren Alphabet', () => {
    const ids = createCryptoIdGenerator();
    for (let i = 0; i < 100; i++) {
      expect(ids.roomId()).toMatch(new RegExp(`^[${ROOM_ID_ALPHABET}]{${ROOM_ID_LENGTH}}$`));
    }
    expect(ROOM_ID_ALPHABET).not.toMatch(/[0O1IL]/);
  });

  it('zieht jedes Zeichen gleichverteilt über das ganze Alphabet', () => {
    const bounds: number[] = [];
    const ids = createCryptoIdGenerator((max) => {
      bounds.push(max);
      return bounds.length - 1;
    });

    expect(ids.roomId()).toBe(ROOM_ID_ALPHABET.slice(0, ROOM_ID_LENGTH));
    expect(bounds).toEqual(Array(ROOM_ID_LENGTH).fill(ROOM_ID_ALPHABET.length));
  });

  it('erzeugt Session-IDs aus 256 Bit Zufall', () => {
    const sizes: number[] = [];
    const ids = createCryptoIdGenerator(undefined, (size) => {
      sizes.push(size);
      return Buffer.alloc(size, 0xff);
    });

    expect(ids.sessionId()).toBe('_'.repeat(42) + '8');
    expect(sizes).toEqual([32]);

    const random = createCryptoIdGenerator();
    expect(random.sessionId()).toMatch(/^[\w-]{43}$/);
    expect(random.sessionId()).not.toBe(random.sessionId());
  });
});
