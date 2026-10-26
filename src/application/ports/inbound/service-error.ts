import { INTENT_ERROR_CODES } from '../../../domain/state/intents';

export const SERVICE_ERROR_CODES = [
  ...INTENT_ERROR_CODES,
  'STALE_STATE',
  'INVALID_CONFIG',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'SESSION_NOT_FOUND',
] as const;
export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];

export interface ServiceFailure {
  readonly ok: false;
  readonly code: ServiceErrorCode;
  /** Optionale Einzelheiten, z. B. die Gründe einer abgelehnten Konfiguration. */
  readonly details?: readonly string[];
}

export function failure(code: ServiceErrorCode, details?: readonly string[]): ServiceFailure {
  return details === undefined ? { ok: false, code } : { ok: false, code, details };
}
