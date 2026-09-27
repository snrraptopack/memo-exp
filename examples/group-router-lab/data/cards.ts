export interface Card {
  id: string;
  title: string;
}

export interface CardDetail {
  summary: string;
}

export type RevealMode = 'progressive' | 'atomic';

export const cards: readonly Card[] = [
  { id: 'fast', title: 'Fast response' },
  { id: 'slow', title: 'Slow response' },
  { id: 'retry', title: 'Retry experiment' },
];
