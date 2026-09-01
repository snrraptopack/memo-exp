import { columns, searchQuery, selectedCategory, setSearchQuery, setSelectedCategory } from '../state';

export function BoardHeader() @{
  const categories = ['All', 'Frontend', 'Backend', 'Design', 'DevOps'];
  const allTasks = columns.flatMap((c) => c.tasks);
  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter((t) => t.completed).length;

  <header class="board-header">
    <style>
      .board-header {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        padding-bottom: 1.5rem;
        border-bottom: 1px solid #282f3d;
      }
      .header-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 1rem;
      }
      .brand-title {
        margin: 0;
        font-size: 1.8rem;
        font-weight: 800;
        letter-spacing: -0.04em;
        color: #f7fafc;
      }
      .brand-badge {
        font-size: 0.75rem;
        font-weight: 700;
        background: #3182ce;
        color: white;
        padding: 0.2rem 0.5rem;
        border-radius: 0.35rem;
        margin-left: 0.5rem;
        text-transform: uppercase;
      }
      .stats-badge {
        font-size: 0.85rem;
        color: #a0aec0;
        background: #1a1e27;
        border: 1px solid #2d3748;
        padding: 0.4rem 0.8rem;
        border-radius: 0.5rem;
      }
      .stats-number {
        color: #63b3ed;
        font-weight: 700;
      }
      .controls-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .search-box {
        background: #14171f;
        border: 1px solid #282f3d;
        color: #e2e8f0;
        border-radius: 0.6rem;
        padding: 0.55rem 0.9rem;
        font-size: 0.9rem;
        width: 16rem;
        outline: none;
      }
      .search-box:focus {
        border-color: #63b3ed;
      }
      .category-filters {
        display: flex;
        gap: 0.4rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .filter-btn {
        background: #14171f;
        border: 1px solid #282f3d;
        color: #a0aec0;
        padding: 0.35rem 0.75rem;
        border-radius: 0.5rem;
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
      }
      .filter-btn.active {
        background: #2b6cb0;
        border-color: #3182ce;
        color: white;
      }
    </style>

    <div class="header-top">
      <h1 class="brand-title">
        Project Workspace
        <span class="brand-badge">Module State</span>
      </h1>
      <div class="stats-badge">
        Progress: <span class="stats-number">{completedTasks}</span> of <span class="stats-number">{totalTasks}</span> done
      </div>
    </div>

    <div class="controls-bar">
      <input
        class="search-box"
        placeholder="Filter tasks by name..."
        value={searchQuery}
        onInput={(e) => setSearchQuery(e.currentTarget.value)}
      />
      <div class="category-filters">
        @for (const cat of categories; key cat) {
          <button
            class={selectedCategory === cat ? 'filter-btn active' : 'filter-btn'}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat}
          </button>
        }
      </div>
    </div>
  </header>
}
