/**
 * @file CodeView.tsx
 * Code view tab component.
 */
export interface CodeViewProps {
  markup: string;
}

export function CodeView({ markup }: CodeViewProps) {
  return (
    <div class="cms-code-box">
      <div class="code-badge">HTML Source View</div>
      <pre class="code-content"><code>{markup}</code></pre>
    </div>
  );
}
