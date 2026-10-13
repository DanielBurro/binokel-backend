import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('liefert Defaults für eine leere Umgebung', () => {
    expect(loadEnv({})).toEqual({
      nodeEnv: 'development',
      port: 3000,
      corsOrigins: '*',
      reconnectGraceMs: 300_000,
      roomTtlMs: 3_600_000,
    });
  });

  it('parst PORT als Zahl', () => {
    expect(loadEnv({ PORT: '8080' }).port).toBe(8080);
  });

  it('weist ungültige Ports ab', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow();
    expect(() => loadEnv({ PORT: '70000' })).toThrow();
  });

  it('sperrt Browser-Origins in Produktion ohne CORS_ORIGIN', () => {
    expect(loadEnv({ NODE_ENV: 'production' }).corsOrigins).toEqual([]);
  });

  it('parst eine kommaseparierte CORS_ORIGIN-Liste', () => {
    const env = loadEnv({ CORS_ORIGIN: 'https://a.example, https://b.example ,' });
    expect(env.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('erlaubt explizit alle Origins mit *', () => {
    expect(loadEnv({ NODE_ENV: 'production', CORS_ORIGIN: '*' }).corsOrigins).toBe('*');
  });
});
