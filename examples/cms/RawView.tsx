/**
 * @file RawView.tsx
 * Raw plain-text tab component.
 */
export interface RawViewProps {
  markup: string;
}

export function RawView({ markup }: RawViewProps) {
  return (
    <div class="cms-raw-box">
      <div class="raw-badge">Unformatted Text String</div>
      <p class="raw-text">{markup}</p>
    </div>
  );
}
