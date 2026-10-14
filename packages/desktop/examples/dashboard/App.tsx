import "./style.css";

/**
 * Visual capability fixture. Keep the content fixed so layout and painting can
 * be examined independently of the event/editing work that follows this batch.
 * Every shape below uses ordinary CSS; no desktop drawing API is involved.
 */
export function App() {
  return (
    <div class="workspace">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark">M</span> Meridian
        </div>
        <p class="sidebar-label">WORKSPACE</p>
        <nav aria-label="Workspace navigation">
          <a class="nav-item selected" href="#overview">
            Overview <span>01</span>
          </a>
          <a class="nav-item" href="#projects">
            Projects <span>04</span>
          </a>
          <a class="nav-item" href="#shapes">
            Shape lab <span>06</span>
          </a>
        </nav>
        <div class="sidebar-note">
          <span class="status-dot"></span>
          <p>
            Native presentation
            <br />
            <strong>Ordinary TSX + CSS</strong>
          </p>
        </div>
      </aside>

      <main class="dashboard" id="overview">
        <header class="page-header">
          <div>
            <p class="eyebrow">MONDAY, OCTOBER 14</p>
            <h1>
              A little clarity.
              <br />A lot of possibility.
            </h1>
            <p class="muted">
              A visual playground for layout, typography and native painting.
            </p>
          </div>
          <div class="avatar-stack" aria-label="Three team members">
            <span class="avatar lavender">AL</span>
            <span class="avatar peach">MK</span>
            <span class="avatar mint">JS</span>
          </div>
        </header>

        <section class="metrics" aria-label="Workspace metrics">
          <article class="card metric">
            <p class="metric-label">Active projects</p>
            <div class="metric-value">
              24 <span class="badge positive">+4 this month</span>
            </div>
            <div class="sparkline" aria-label="Increasing activity">
              <span class="bar bar-1"></span>
              <span class="bar bar-2"></span>
              <span class="bar bar-3"></span>
              <span class="bar bar-4"></span>
              <span class="bar bar-5"></span>
              <span class="bar bar-6"></span>
              <span class="bar bar-7"></span>
              <span class="bar bar-8"></span>
            </div>
          </article>
          <article class="card metric">
            <p class="metric-label">Weekly focus</p>
            <div class="metric-value">
              32.5 <span class="unit">hours</span>
            </div>
            <p class="muted small">81% of your weekly target</p>
            <div class="progress-track">
              <div class="progress-fill"></div>
            </div>
          </article>
          <article class="card metric accent-card">
            <p class="metric-label">A balanced week</p>
            <div class="metric-value">Looking good.</div>
            <p class="small">Make room for the work that matters.</p>
            <div class="orbit-decoration" aria-hidden="true">
              <span></span>
            </div>
          </article>
        </section>

        <div class="content-grid">
          <section class="card projects" id="projects">
            <div class="section-heading">
              <h2>Current projects</h2>
              <span class="badge neutral">4 projects</span>
            </div>
            <p class="muted small">
              A table checks intrinsic sizing, borders and text alignment.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Design system</strong>
                    <p class="muted small">Foundations & components</p>
                  </td>
                  <td>
                    <span class="badge positive">On track</span>
                  </td>
                  <td>78%</td>
                </tr>
                <tr>
                  <td>
                    <strong>Customer portal</strong>
                    <p class="muted small">Product experience</p>
                  </td>
                  <td>
                    <span class="badge purple">Review</span>
                  </td>
                  <td>64%</td>
                </tr>
                <tr>
                  <td>
                    <strong>Brand refresh</strong>
                    <p class="muted small">Identity & direction</p>
                  </td>
                  <td>
                    <span class="badge amber">Planning</span>
                  </td>
                  <td>25%</td>
                </tr>
                <tr>
                  <td>
                    <strong>Native workspace</strong>
                    <p class="muted small">Rendering & layout</p>
                  </td>
                  <td>
                    <span class="badge positive">On track</span>
                  </td>
                  <td>42%</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="card activity">
            <h2>Today’s rhythm</h2>
            <div class="timeline">
              <div class="timeline-item">
                <span class="timeline-dot"></span>
                <div>
                  <p class="small muted">09:00</p>
                  <h3>Make something useful</h3>
                  <p class="small muted">Explore the visual foundations.</p>
                </div>
              </div>
              <div class="timeline-item">
                <span class="timeline-dot pink-dot"></span>
                <div>
                  <p class="small muted">11:30</p>
                  <h3>A fresh perspective</h3>
                  <p class="small muted">Review spacing and responsive flow.</p>
                </div>
              </div>
              <div class="timeline-item">
                <span class="timeline-dot green-dot"></span>
                <div>
                  <p class="small muted">14:00</p>
                  <h3>Bring it together</h3>
                  <p class="small muted">
                    Check shapes and text at different sizes.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <section class="card shape-lab" id="shapes">
          <div class="section-heading">
            <h2>Shape lab</h2>
            <span class="badge neutral">CSS only</span>
          </div>
          <p class="muted small">
            These specimens exercise native paint. Resize the window and inspect
            their edges.
          </p>
          <div class="shape-grid">
            <div class="specimen">
              <div class="shape circle"></div>
              <p>Circle</p>
              <span>border-radius</span>
            </div>
            <div class="specimen">
              <div class="shape ring"></div>
              <p>Ring</p>
              <span>border + radius</span>
            </div>
            <div class="specimen">
              <div class="shape diamond"></div>
              <p>Diamond</p>
              <span>transform</span>
            </div>
            <div class="specimen">
              <div class="triangle"></div>
              <p>Triangle</p>
              <span>border geometry</span>
            </div>
            <div class="specimen">
              <div class="shape gradient-tile"></div>
              <p>Gradient</p>
              <span>linear-gradient</span>
            </div>
            <div class="specimen">
              <div class="shape shadow-tile"></div>
              <p>Elevation</p>
              <span>box-shadow</span>
            </div>
          </div>
        </section>
        <footer class="page-footer">
          Visual fixture • Fixed content • Scroll to inspect every section
        </footer>
      </main>
    </div>
  );
}
