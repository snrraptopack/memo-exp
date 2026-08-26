import { compile } from '@memoized-dom/compiler';

export const TABLE_SOURCE = `
let rows = Array.from({ length: 1000 }, (_, i) => ({
  id: i + 1,
  label: 'Row #' + (i + 1),
  value: (i * 17) % 100,
  active: i % 2 === 0,
}));

function TableRow(item) {
  return (
    <tr class={item.active ? 'active' : 'idle'}>
      <td>{item.id}</td>
      <td>{item.label}</td>
      <td>{item.value}</td>
    </tr>
  );
}

export function App() {
  return (
    <div class="table-container">
      <h1>Data Grid (1,000 rows)</h1>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Label</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => <TableRow item={row} key={row.id} />)}
        </tbody>
      </table>
    </div>
  );
}
`;

export const DASHBOARD_SOURCE = `
let user = { name: 'Ada Lovelace', role: 'admin', unread: 3 };
let metrics = [
  { id: 'm1', name: 'CPU', value: '42%' },
  { id: 'm2', name: 'Memory', value: '1.2 GB' },
  { id: 'm3', name: 'Disk', value: '88%' },
  { id: 'm4', name: 'Network', value: '120 MB/s' },
];

function Card(item) {
  return (
    <div class="card">
      <h3>{item.name}</h3>
      <p>{item.value}</p>
    </div>
  );
}

export function App() {
  return (
    <div class="dashboard">
      <header>
        <h2>Dashboard</h2>
        {user.role === 'admin' ? <span class="badge">{\`Admin: \${user.name}\`}</span> : <span>User</span>}
        <span class="pill">{\`\${user.unread} unread\`}</span>
      </header>
      <section class="grid">
        {metrics.map((m) => <Card item={m} key={m.id} />)}
      </section>
    </div>
  );
}
`;

export function compileScenario(source: string): string {
  return compile(source, { runtimePath: '@memoized-dom/runtime' });
}
