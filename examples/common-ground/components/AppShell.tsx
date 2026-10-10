import { Icon } from "./ui";
import { view, crewIds, savedIds, selectView, openDialog } from "../state";
export function AppShell({ children }: { children: JSX.Child }) {
  return (
    <div class="app-shell">
      <div class="announcement">
        <span>
          <span class="yellow-star">✳</span> A little ambition. A lot of good
          company.
        </span>
        <span>
          Independent minds. Shared possibilities.{" "}
          <span class="yellow-star">↗</span>
        </span>
      </div>
      <header class="site-header">
        <a class="wordmark" href="./" aria-label="Common Ground home">
          <span class="brand-symbol">
            <i></i>
            <i></i>
            <i></i>
          </span>
          <span>
            common
            <br />
            ground<span class="brand-dot">.</span>
          </span>
        </a>
        <nav class="nav-pills" aria-label="Main navigation">
          <button
            class={view === "discover" ? "active" : ""}
            aria-current={view === "discover" ? "page" : "false"}
            onClick={() => selectView("discover")}
          >
            Discover
          </button>
          <button
            class={view === "studio" ? "active" : ""}
            aria-current={view === "studio" ? "page" : "false"}
            onClick={() => selectView("studio")}
          >
            My studio <span class="nav-count">{crewIds.length}</span>
          </button>
          <button
            class={view === "saved" ? "active" : ""}
            aria-current={view === "saved" ? "page" : "false"}
            onClick={() => selectView("saved")}
          >
            Saved <span class="nav-count">{savedIds.length}</span>
          </button>
          <button onClick={() => openDialog("about-dialog")}>
            How it works
          </button>
        </nav>
        <div class="header-actions">
          <span class="my-avatar">Y</span>
          <button
            class="button primary"
            onClick={() => openDialog("brief-dialog")}
          >
            New project <Icon name="plus" />
          </button>
        </div>
      </header>
      <main class="page-main">{children}</main>
      <footer class="site-footer">
        <span class="footer-brand">Good things happen on common ground.</span>
        <span>
          A little studio for big possibilities.{" "}
          <span>Made with memoized-dom.</span>
        </span>
      </footer>
    </div>
  );
}
