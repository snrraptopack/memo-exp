function Leaf({ theme }: { theme: string }) {
  return <span data-testid="leaf">leaf sees: {theme}</span>;
}

function Middle({ theme }: { theme: string }) {
  return (
    <div>
      <Leaf theme={theme} />
    </div>
  );
}

export function UseContextCase() {
  let theme: 'light' | 'dark' = 'light';
  return (
    <section>
      <h2>useContext — provider through layers</h2>
      <Middle theme={theme} />
      <p>
        Outside provider: <Leaf theme="light" />
      </p>
      <button onClick={() => (theme = theme === 'light' ? 'dark' : 'light')}>
        toggle theme
      </button>
    </section>
  );
}
