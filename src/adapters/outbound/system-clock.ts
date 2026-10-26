import type { ClockPort } from '../../application/ports/outbound/clock.port';

export const systemClock: ClockPort = { now: () => Date.now() };
