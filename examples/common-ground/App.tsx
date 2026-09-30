import { fieldValue, fieldChecked } from "./dom";
import { people } from "./data";
import {
  view,
  savedIds,
  notice,
  clearNotice,
  selectView,
  openDialog,
} from "./state";
import { AppShell } from "./components/AppShell";
import { Hero } from "./components/Hero";
import { Icon, Section } from "./components/ui";
import {
  TalentCollection,
  TalentCard,
  TalentActions,
} from "./components/TalentCard";
import { CrewPanel } from "./components/CrewPanel";
import { Studio } from "./components/Studio";
import { AppDialogs } from "./components/Dialogs";

export function CommonGroundApp() {
  let query = "";
  let discipline = "All minds";
  let availableOnly = false;
  let sort = "recommended";
  const filtered = people.filter(
    (person) =>
      (discipline === "All minds" || person.discipline === discipline) &&
      (!availableOnly || person.available) &&
      (view !== "saved" || savedIds.includes(person.id)) &&
      `${person.name} ${person.role} ${person.city} ${person.skills.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const visible =
    sort === "budget"
      ? [...filtered].sort((a, b) => a.rate - b.rate)
      : filtered;
  return (
    <AppShell>
      {view !== "studio" && (
        <div>
          <Hero />
          <div class="discovery-layout">
            <div class="discovery-main">
              <Section
                eyebrow={
                  view === "saved"
                    ? "KEEP THE GOOD ONES CLOSE"
                    : "INDEPENDENT MINDS. SHARED AMBITION."
                }
                title={
                  view === "saved"
                    ? "Your kind of good company."
                    : "Good company, found."
                }
                action={
                  <span class="results-label">
                    {visible.length} creative mind
                    {visible.length === 1 ? "" : "s"}
                  </span>
                }
              >
                <div class="discovery-controls">
                  <label class="search-field">
                    <Icon name="search" />
                    <input
                      aria-label="Search collaborators"
                      placeholder="A name, a skill, a little curiosity…"
                      value={query}
                      onInput={(e: Event) => {
                        query = fieldValue(e);
                      }}
                    />
                    {query && (
                      <button
                        class="icon-button"
                        aria-label="Clear search"
                        onClick={() => {
                          query = "";
                        }}
                      >
                        <Icon name="close" />
                      </button>
                    )}
                  </label>
                  <select
                    class="sort-select"
                    aria-label="Sort collaborators"
                    value={sort}
                    onChange={(e: Event) => {
                      sort = fieldValue(e);
                    }}
                  >
                    <option value="recommended">Recommended</option>
                    <option value="budget">Day rate: low to high</option>
                  </select>
                </div>
                <div class="filter-row">
                  <div
                    class="discipline-tabs"
                    role="group"
                    aria-label="Filter by discipline"
                  >
                    <button
                      class={discipline === "All minds" ? "selected" : ""}
                      aria-pressed={discipline === "All minds"}
                      onClick={() => {
                        discipline = "All minds";
                      }}
                    >
                      All minds
                    </button>
                    <button
                      class={discipline === "Design" ? "selected" : ""}
                      aria-pressed={discipline === "Design"}
                      onClick={() => {
                        discipline = "Design";
                      }}
                    >
                      Design
                    </button>
                    <button
                      class={discipline === "Engineering" ? "selected" : ""}
                      aria-pressed={discipline === "Engineering"}
                      onClick={() => {
                        discipline = "Engineering";
                      }}
                    >
                      Engineering
                    </button>
                    <button
                      class={discipline === "Strategy" ? "selected" : ""}
                      aria-pressed={discipline === "Strategy"}
                      onClick={() => {
                        discipline = "Strategy";
                      }}
                    >
                      Strategy
                    </button>
                  </div>
                  <label class="available-filter">
                    <input
                      type="checkbox"
                      checked={availableOnly}
                      onChange={(e: Event) => {
                        availableOnly = fieldChecked(e);
                      }}
                    />
                    Available now
                  </label>
                </div>
                <TalentCollection
                  items={visible}
                  renderItem={(person) => (
                    <TalentCard
                      key={person.id}
                      person={person}
                      footer={<TalentActions person={person} />}
                    />
                  )}
                />
                {visible.length === 0 && (
                  <div class="empty-state">
                    <Icon name="search" />
                    <h3>A little too specific?</h3>
                    <p>
                      {view === "saved"
                        ? "Save a few profiles, or try a different search."
                        : "Try another skill or open up your filters. Good company is here."}
                    </p>
                    <button
                      class="button secondary"
                      onClick={() => {
                        query = "";
                        discipline = "All minds";
                        availableOnly = false;
                        selectView("discover");
                      }}
                    >
                      Explore all minds <Icon name="arrow" />
                    </button>
                  </div>
                )}
              </Section>
            </div>
            <div class="discovery-sidebar">
              <CrewPanel
                footer={
                  <button
                    class="tiny-link"
                    onClick={() => openDialog("about-dialog")}
                  >
                    A little help getting started <Icon name="arrow" />
                  </button>
                }
              />
              <div class="sidebar-note">
                <span>✳</span>
                <p>
                  The best teams don't think alike.
                  <br />
                  <strong>They think together.</strong>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      {view === "studio" && <Studio />}
      <AppDialogs />
      {notice && (
        <div class="toast" role="status">
          <span class="toast-icon">
            <Icon name="check" />
          </span>
          <span>{notice}</span>
          <button
            class="icon-button"
            aria-label="Dismiss notification"
            onClick={() => clearNotice()}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
    </AppShell>
  );
}
