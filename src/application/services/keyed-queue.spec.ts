import { describe, expect, it } from 'vitest';
import { createKeyedQueue } from './keyed-queue';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('createKeyedQueue', () => {
  it('führt Aufgaben mit gleichem Schlüssel strikt nacheinander aus', async () => {
    const queue = createKeyedQueue();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name} start`);
      await tick();
      log.push(`${name} ende`);
      return name;
    };

    const results = await Promise.all([queue.run('a', task('1')), queue.run('a', task('2'))]);

    expect(results).toEqual(['1', '2']);
    expect(log).toEqual(['1 start', '1 ende', '2 start', '2 ende']);
  });

  it('lässt verschiedene Schlüssel parallel laufen', async () => {
    const queue = createKeyedQueue();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name} start`);
      await tick();
      log.push(`${name} ende`);
    };

    await Promise.all([queue.run('a', task('a')), queue.run('b', task('b'))]);

    expect(log).toEqual(['a start', 'b start', 'a ende', 'b ende']);
  });

  it('setzt die Kette nach einem Fehler fort', async () => {
    const queue = createKeyedQueue();
    const failed = queue.run('a', async () => {
      throw new Error('kaputt');
    });
    const next = queue.run('a', async () => 'weiter');

    await expect(failed).rejects.toThrow('kaputt');
    await expect(next).resolves.toBe('weiter');
  });

  it('entfernt abgearbeitete Schlüssel', async () => {
    const queue = createKeyedQueue();
    const running = queue.run('a', async () => tick());
    expect(queue.size).toBe(1);

    await running;
    await tick();

    expect(queue.size).toBe(0);
  });
});
