import { createContext, useContext, useState } from 'react';

const ThemeContext = createContext('light');

function Leaf() {
  const theme = useContext(ThemeContext);
  return <span data-testid="leaf">leaf sees: {theme}</span>;
}

function Middle() {
  return (
    <div>
      <Leaf />
    </div>
  );
}

export function UseContextCase() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  return (
    <section>
      <h2>useContext — provider through layers</h2>
      <ThemeContext.Provider value={theme}>
        <Middle />
      </ThemeContext.Provider>
      <p>
        Outside provider: <Leaf />
      </p>
      <button
        onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
      >
        toggle theme
      </button>
    </section>
  );
}
