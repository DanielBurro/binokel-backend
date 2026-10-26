export interface KeyedQueue {
  /** Aufgaben mit gleichem Schlüssel laufen strikt nacheinander, verschiedene Schlüssel parallel. */
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** Anzahl der Schlüssel mit laufenden oder wartenden Aufgaben. */
  readonly size: number;
}

/** Promise-Kette je Schlüssel; leere Ketten werden entfernt, damit der Speicher nicht wächst. */
export function createKeyedQueue(): KeyedQueue {
  const tails = new Map<string, Promise<void>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const result = (tails.get(key) ?? Promise.resolve()).then(task);
      // Ein Fehler betrifft nur die eigene Aufgabe, nicht die nachfolgenden.
      const tail = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
    get size() {
      return tails.size;
    },
  };
}
