import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().optional(),
  RECONNECT_GRACE_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60_000),
  ROOM_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60_000),
});

export interface Env {
  nodeEnv: string;
  port: number;
  /** '*' erlaubt jeden Origin; eine leere Liste sperrt Browser-Origins (native Clients senden keinen). */
  corsOrigins: '*' | string[];
  /** Zeit, die ein getrennter Sitz für einen Reconnect reserviert bleibt. */
  reconnectGraceMs: number;
  /** Inaktivitätsdauer, nach der ein Raum aus dem Speicher entfernt wird. */
  roomTtlMs: number;
}

function parseCorsOrigins(raw: string | undefined, isProduction: boolean): '*' | string[] {
  if (raw === undefined) {
    return isProduction ? [] : '*';
  }
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return origins.includes('*') ? '*' : origins;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source);
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    corsOrigins: parseCorsOrigins(parsed.CORS_ORIGIN, parsed.NODE_ENV === 'production'),
    reconnectGraceMs: parsed.RECONNECT_GRACE_MS,
    roomTtlMs: parsed.ROOM_TTL_MS,
  };
}
