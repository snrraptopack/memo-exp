import type { Card, CardDetail, RevealMode } from '../data/cards';

export function CardRow({ item, mode, run }: { item: Card; mode: RevealMode; run: string }) {
  const detail = $fetch<CardDetail>('/demo/cards/' + mode + '/' + run + '/' + item.id);

  return <li class="card-row" data-card={item.id}>
    <h2>{item.title}</h2>
    <p class="read-slot">{detail.summary}</p>
    <a route-to={{ path: '/detail/:id', params: { id: item.id } }}>Open prepared detail</a>
  </li>;
}
