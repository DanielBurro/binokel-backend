import { RANK_STRENGTH, type Card, type Suit } from '../cards/card';
import type { Seat } from './parties';

export interface TrickPlay {
  readonly seat: Seat;
  readonly card: Card;
}

/**
 * c schlägt c' (Studienarbeit, Phase 6): gleiche Farbe mit höherem Rang, oder Trumpf gegen eine
 * Nicht-Trumpfkarte. Die Relation ist strikt, eine identische Karte schlägt also nicht.
 */
export function beats(card: Card, other: Card, trump: Suit): boolean {
  if (card.suit === other.suit) return RANK_STRENGTH[card.rank] > RANK_STRENGTH[other.rank];
  return card.suit === trump;
}

/**
 * Stichentscheid: Die stichhöchste Karte wechselt nur, wenn eine gelegte Karte sie schlägt. Bei
 * zwei identischen Karten behält deshalb die zuerst gelegte den Stich.
 */
export function leadingPlay(plays: readonly TrickPlay[], trump: Suit): TrickPlay {
  if (plays.length === 0) throw new RangeError('Ein leerer Stich hat keine stichhöchste Karte');
  return plays.reduce((lead, play) => (beats(play.card, lead.card, trump) ? play : lead));
}

/**
 * Gültige Spielzüge L(H_p): Wer den Stich eröffnet, darf alles legen. Sonst gilt Farbzwang vor
 * Trumpfzwang (B_p ist die erste nichtleere Menge aus angespielter Farbe, Trümpfen und ganzer
 * Hand), danach der Stichzwang: Kann eine Karte aus B_p die stichhöchste Karte schlagen, muss es
 * eine solche sein. Daraus folgt, dass eine bereits abgestochene Fehlfarbe nur noch bedient
 * werden muss und ein liegender Trumpf überstochen werden muss, sofern möglich.
 */
export function legalCards(
  hand: readonly Card[],
  plays: readonly TrickPlay[],
  trump: Suit,
): Card[] {
  if (plays.length === 0) return [...hand];
  const led = plays[0].card.suit;
  const lead = leadingPlay(plays, trump).card;

  const following = hand.filter((card) => card.suit === led);
  const trumps = hand.filter((card) => card.suit === trump);
  const mustChooseFrom = following.length > 0 ? following : trumps.length > 0 ? trumps : [...hand];
  const overtaking = mustChooseFrom.filter((card) => beats(card, lead, trump));
  return overtaking.length > 0 ? overtaking : mustChooseFrom;
}
