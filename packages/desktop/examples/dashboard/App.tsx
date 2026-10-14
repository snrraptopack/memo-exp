import "./style.css";

interface AvatarProps {
  tone: string;
  label: string;
}

interface StatusBadgeProps {
  tone: string;
  label: string;
}

function Avatar({ tone, label }: AvatarProps) {
  return <span class={`avatar ${tone}`}>{label}</span>;
}

function StatusBadge({ tone, label }: StatusBadgeProps) {
  return <span class={`badge ${tone}`}>{label}</span>;
}

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
            <Avatar tone="lavender" label="AL" />
            <Avatar tone="peach" label="MK" />
            <Avatar tone="mint" label="JS" />
          </div>
        </header>

        <section class="metrics" aria-label="Workspace metrics">
          <article class="card metric">
            <p class="metric-label">Active projects</p>
            <div class="metric-value">
              24 <StatusBadge tone="positive" label="+4 this month" />
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
              <StatusBadge tone="neutral" label="4 projects" />
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
                    <StatusBadge tone="positive" label="On track" />
                  </td>
                  <td>78%</td>
                </tr>
                <tr>
                  <td>
                    <strong>Customer portal</strong>
                    <p class="muted small">Product experience</p>
                  </td>
                  <td>
                    <StatusBadge tone="purple" label="Review" />
                  </td>
                  <td>64%</td>
                </tr>
                <tr>
                  <td>
                    <strong>Brand refresh</strong>
                    <p class="muted small">Identity & direction</p>
                  </td>
                  <td>
                    <StatusBadge tone="amber" label="Planning" />
                  </td>
                  <td>25%</td>
                </tr>
                <tr>
                  <td>
                    <strong>Native workspace</strong>
                    <p class="muted small">Rendering & layout</p>
                  </td>
                  <td>
                    <StatusBadge tone="positive" label="On track" />
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
            <StatusBadge tone="neutral" label="CSS only" />
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
        <section class="card vector-lab">
          <div class="section-heading">
            <h2>Vector lab</h2>
            <StatusBadge tone="neutral" label="Inline SVG" />
          </div>
          <p class="muted small">
            Paths, a gradient, circles and rounded rectangles share one viewBox.
            Resize to check that the artwork scales without changing its
            geometry.
          </p>
          <svg
            class="vector-art"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 720 180"
            width="720"
            height="180"
            role="img"
            aria-label="A curved activity line beside a vector orbit illustration"
          >
            <defs>
              <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#a48bdf" stop-opacity="0.45" />
                <stop offset="100%" stop-color="#a48bdf" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="720" height="180" rx="14" fill="#faf9fc" />
            <path
              d="M 24 132 H 470 M 24 86 H 470 M 24 40 H 470"
              fill="none"
              stroke="#e9e3f1"
            />
            <path
              d="M 24 128 C 72 128 64 60 120 76 S 190 130 230 88 S 300 24 340 52 S 420 110 470 32 L 470 154 H 24 Z"
              fill="url(#activity-fill)"
            />
            <path
              d="M 24 128 C 72 128 64 60 120 76 S 190 130 230 88 S 300 24 340 52 S 420 110 470 32"
              fill="none"
              stroke="#9676ce"
              stroke-width="3"
              stroke-linecap="round"
            />
            <circle cx="470" cy="32" r="6" fill="#9676ce" />
            <circle
              cx="608"
              cy="90"
              r="54"
              fill="none"
              stroke="#cabbe8"
              stroke-width="2"
            />
            <circle cx="608" cy="90" r="34" fill="#e9e1f6" />
            <circle cx="608" cy="90" r="14" fill="#ab91d7" />
            <circle cx="652" cy="60" r="9" fill="#d8abbd" />
          </svg>
        </section>
        <footer class="page-footer">
          Visual fixture • Fixed content • Scroll to inspect every section
        </footer>
      </main>
    </div>
  );
}
