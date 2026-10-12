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

function Caption({ children }: { children: JSX.Element }) {
  let clicks = 0;
  return <span id="caption" class="caption" onClick={() => clicks++}>
    {children}<span id="caption-count"> ({clicks})</span>
  </span>;
}

function CursorLabel({ children }: { children: JSX.Child }) {
  // This component contributes an inline source, not a layout wrapper. Its
  // cursor declaration is inherited by glyphs forwarded from the caller.
  return <span id="cursor-parent" class="cursor-parent">{children}</span>;
}

export function InlineBoxes() {
  let width = 220;
  let parentClicks = 0;
  let resizeReleases = 0;
  let submissions = 0;
  // oxlint-disable-next-line no-unassigned-vars
  let focusEditor: HTMLInputElement | undefined;
  let focusEvents = 0;
  let blurEvents = 0;

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
      <p id="inline-paragraph" class="paragraph-flow">
        Before <Caption><strong id="caption-text">wrapped 🙂 glyphs follow component roots across lines</strong></Caption> after.
      </p>
      <input
        id="ref-focus-editor"
        ref={focusEditor}
        placeholder="Focus this input through its ref"
        onFocus={() => focusEvents++}
        onBlur={() => blurEvents++}
      />
      <button id="ref-focus" onClick={() => focusEditor?.focus()}>
        Focus input ref
      </button>
      <button id="ref-focus-preserve" onClick={() => focusEditor?.focus({ preventScroll: true })}>
        Focus without scrolling
      </button>
      <button id="ref-blur" onClick={() => focusEditor?.blur()}>
        Blur input ref
      </button>
      <p>Ref focus events: {focusEvents}; blur events: {blurEvents}</p>
      <p id="hover-only-paragraph" class="paragraph-flow">
        Plain text <span id="hover-only">hover without a handler</span> stays in one paragraph.
      </p>
      <p id="cursor-paragraph" class="paragraph-flow">
        <CursorLabel>
          <span id="cursor-inherited">Inherited hand</span>{' '}
          <span id="cursor-text">Text cursor</span>{' '}
          <span id="cursor-default">Default cursor</span>
        </CursorLabel>{' '}
        <span id="cursor-hover">Hover cursor</span>{' '}
        <span id="cursor-plain">Enclosing cursor</span>
      </p>
      <form onSubmit={event => { event.preventDefault(); submissions++; }}>
        <button id="save" type="submit"><span id="save-label">A button's inline label</span></button>
        <p>Submissions: {submissions}</p>
      </form>
    </main>
  );
}
