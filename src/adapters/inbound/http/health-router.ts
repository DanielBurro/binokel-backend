import { Router } from 'express';
import type { ClockPort } from '../../../application/ports/outbound/clock.port';

export const HEALTH_PATH = '/health';

export interface HealthResponse {
  readonly status: 'ok';
  /** Ganze Sekunden seit dem Start des Servers. */
  readonly uptimeSeconds: number;
}

/**
 * Systemprüfung für Betrieb und Docker-`HEALTHCHECK`: Antwortet der Prozess, ist er gesund.
 * Der Endpunkt liest keinen Spielzustand und braucht deshalb keine Sperre.
 */
export function createHealthRouter(clock: ClockPort): Router {
  const startedAt = clock.now();
  const router = Router();
  router.get(HEALTH_PATH, (_request, response) => {
    const body: HealthResponse = {
      status: 'ok',
      uptimeSeconds: Math.floor((clock.now() - startedAt) / 1000),
    };
    response.set('Cache-Control', 'no-store').json(body);
  });
  return router;
}
