/**
 * @file PreviewView.tsx
 * Demonstrates R31 — reactive innerHTML prop on host elements.
 */
export interface PreviewViewProps {
  markup: string;
}

export function PreviewView({ markup }: PreviewViewProps) {
  return (
    <div class="cms-preview-box">
      <div class="preview-badge">Live R31 innerHTML Output</div>
      <div class="preview-content" innerHTML={markup} />
    </div>
  );
}
