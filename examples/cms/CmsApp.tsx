/**
 * @file CmsApp.tsx
 * Demonstrates R29 (JSX Aliases), R30 (Dynamic Tags), R31 (innerHTML), and R32 (Module Effects).
 */
import {
  rawMarkup,
  containerTag,
  activeTab,
  autoSaveLog,
  setRawMarkup,
  setContainerTag,
  setActiveTab,
  type ContainerTag,
  type ViewTab,
} from './cms-state';
import { PreviewView } from './PreviewView';
import { CodeView } from './CodeView';
import { RawView } from './RawView';

export function CmsApp() {
  // R29: Component-local JSX node stored in a variable render alias
  const headerAlias = (
    <header class="cms-header">
      <h1>📝 CMS Content Studio</h1>
      <p class="subtitle">
        Showcasing <strong>R29 JSX Aliases</strong>, <strong>R30 Dynamic Tags</strong>, <strong>R31 innerHTML</strong>, & <strong>R32 Module Effects</strong>.
      </p>
    </header>
  );

  // R30: Dynamic Component Tag computed at render time
  const SelectedViewComponent =
    activeTab === 'preview'
      ? PreviewView
      : activeTab === 'code'
      ? CodeView
      : RawView;

  // R30: Dynamic Intrinsic Host Tag computed at render time
  const LayoutContainerTag = containerTag;

  let count = 0;
  const incrementCount = () => count++;
  const color = () => `#${Math.random().toString(16).slice(2,8).padStart(6,'0')}`;

  return (
    <div class="cms-app-container">
      {/* R29 JSX Render Alias */}
      {headerAlias}

      <button onClick={incrementCount} style={{ backgroundColor: color() }}>
        <span>{color()}</span>
      </button>
      <div class="cms-editor-grid">
        {/* Input Panel */}
        <div class="cms-panel input-panel">
          <div class="panel-header">
            <h3>HTML Editor</h3>
            <span class="save-status">{autoSaveLog}</span>
          </div>

          <textarea
            class="cms-textarea"
            value={rawMarkup}
            onInput={(e: any) => setRawMarkup(e.target.value)}
          />

          <div class="controls-row">
            <label>Container Tag (R30 Dynamic Host):</label>
            <div class="tag-selector">
              {(['section', 'article', 'aside'] as ContainerTag[]).map((t) => (
                <button
                  class={`tag-btn ${containerTag === t ? 'active' : ''}`}
                  onClick={() => setContainerTag(t)}
                >
                  &lt;{t}&gt;
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Output Panel */}
        <div class="cms-panel output-panel">
          <div class="panel-header">
            <div class="view-tabs">
              {(['preview', 'code', 'raw'] as ViewTab[]).map((tab) => (
                <button
                  class={`tab-btn ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* R30: Dynamic Intrinsic Tag (<LayoutContainerTag>) wrapping R30 Dynamic Component (<SelectedViewComponent>) */}
          <LayoutContainerTag class="cms-dynamic-wrapper">
            <SelectedViewComponent markup={rawMarkup} />
          </LayoutContainerTag>
        </div>
      </div>
    </div>
  );
}
