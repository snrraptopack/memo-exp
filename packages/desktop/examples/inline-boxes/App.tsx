import type {} from '@memoized-dom/compiler/jsx';
import './app.css';

function Chip({ width }: { width: number }) {
  let clicks = 0;
  let downs = 0;
  let ups = 0;

  // This span is a direct flex item, so its native box supplies sizing and
  // pointer hit testing. The nested strong and br remain paragraph content.
  return (
    <span
      id="chip"
      class="chip"
      style={{ width: `${width}px` }}
      onClick={() => clicks++}
      onPointerDown={() => downs++}
      onPointerUp={() => ups++}
    >
      <strong>Clicks: {clicks}</strong><br />
      Down: {downs}<br />
      Up: {ups}
    </span>
  );
}

export function InlineBoxes() {
  let width = 220;
  let parentClicks = 0;
  let resizeReleases = 0;

  return (
    <main id="inline-page">
      <h1 id="title">Inline elements with native boxes</h1>
      <p>Hover the chip, click it, and resize it. Its state survives the CSS change.</p>

      <div class="inline-items" onClick={() => parentClicks++}>
        <Chip width={width} />
        <em id="sibling" class="sibling">A sized flex sibling</em>
      </div>
      <p>Parent clicks: {parentClicks}</p>
      <button
        id="resize"
        onPointerUp={() => resizeReleases++}
        onClick={() => width = width === 220 ? 280 : 220}
      >
        Resize chip
      </button>
      <p>Resize pointer releases: {resizeReleases}</p>

      <h2>A span can also own a grid</h2>
      <div class="inline-items">
        <span id="inline-grid" class="inline-grid">
          <strong id="cell-a" class="grid-cell">First cell</strong>
          <em id="cell-b" class="grid-cell">Second cell</em>
        </span>
      </div>
      <p>Text inside a normal paragraph still shares one shaped text group.</p>
    </main>
  );
}
