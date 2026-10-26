import { randomBytes, randomInt } from 'node:crypto';
import type { IdGeneratorPort } from '../../application/ports/outbound/id-generator.port';

/** Ohne leicht verwechselbare Zeichen wie 0/O und 1/I/L, damit sich die ID gut abtippen lässt. */
export const ROOM_ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_ID_LENGTH = 6;
/** 256 Bit Zufall, base64url-kodiert. */
const SESSION_ID_BYTES = 32;

export function createCryptoIdGenerator(
  nextInt: (maxExclusive: number) => number = (max) => randomInt(max),
  nextBytes: (size: number) => Buffer = randomBytes,
): IdGeneratorPort {
  return {
    roomId() {
      return Array.from(
        { length: ROOM_ID_LENGTH },
        () => ROOM_ID_ALPHABET[nextInt(ROOM_ID_ALPHABET.length)],
      ).join('');
    },
    sessionId() {
      return nextBytes(SESSION_ID_BYTES).toString('base64url');
    },
  };
}
