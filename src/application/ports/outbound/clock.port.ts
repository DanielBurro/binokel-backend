export interface ClockPort {
  /** Millisekunden seit der Unix-Epoche. */
  now(): number;
}
