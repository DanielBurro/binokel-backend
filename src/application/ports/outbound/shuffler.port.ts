export interface ShufflerPort {
  /** Liefert eine gleichverteilt gemischte Kopie; die Eingabe bleibt unverändert. */
  shuffle<T>(items: readonly T[]): T[];
}
