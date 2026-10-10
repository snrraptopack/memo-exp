import type { Person } from "../data";
import {
  crewIds,
  savedIds,
  toggleSaved,
  addToCrew,
  openProfile,
} from "../state";
import { Icon } from "./ui";
export function TalentCollection({
  items,
  renderItem,
}: {
  items: Person[];
  renderItem: (person: Person) => JSX.Child;
}) {
  return (
    <div class="talent-grid">{items.map((person) => renderItem(person))}</div>
  );
}
export function TalentCard({
  person,
  footer,
}: {
  person: Person;
  footer: JSX.Child;
}) {
  let expanded = false;
  return (
    <article class="talent-card" data-person={person.id}>
      <div class={`portrait-area ${person.color}`}>
        <span class={person.available ? "availability" : "availability booked"}>
          <i></i>
          {person.available ? "Open to collaborate" : "Booked this month"}
        </span>
        <button
          class={
            savedIds.includes(person.id) ? "save-button saved" : "save-button"
          }
          aria-label={
            savedIds.includes(person.id)
              ? `Unsave ${person.name}`
              : `Save ${person.name}`
          }
          aria-pressed={savedIds.includes(person.id)}
          onClick={() => toggleSaved(person.id)}
        >
          <Icon name="bookmark" />
        </button>
        <img class="portrait-image" src={person.portrait} alt="" />
        <span class="portrait-mark">
          {person.initials}
          <span>↗</span>
        </span>
      </div>
      <div class="talent-content">
        <div class="talent-title">
          <button class="person-link" onClick={() => openProfile(person.id)}>
            <h3>{person.name}</h3>
          </button>
          <span class="verified" title="Fictional demo profile">
            <Icon name="check" />
          </span>
        </div>
        <p class="person-role">{person.role}</p>
        <p class="person-city">
          <Icon name="globe" />
          {person.city}
        </p>
        <div class="skill-tags">
          {person.skills.map((skill) => (
            <span key={skill}>{skill}</span>
          ))}
        </div>
        {expanded && <p class="card-bio">{person.bio}</p>}
        <button
          class="tiny-link"
          aria-expanded={expanded}
          onClick={() => {
            expanded = !expanded;
          }}
        >
          {expanded
            ? "A little less"
            : "Get to know " + person.name.split(" ")[0]}{" "}
          <span>{expanded ? "−" : "+"}</span>
        </button>
        {footer}
      </div>
    </article>
  );
}
export function TalentActions({ person }: { person: Person }) {
  return (
    <div class="talent-actions">
      <div>
        <strong>GH₵ {person.rate}</strong>
        <span> / day</span>
      </div>
      <button
        class={crewIds.includes(person.id) ? "add-button added" : "add-button"}
        disabled={crewIds.includes(person.id) || !person.available}
        onClick={() => addToCrew(person.id)}
        aria-label={
          crewIds.includes(person.id)
            ? `${person.name} is in your crew`
            : `Add ${person.name} to your crew`
        }
      >
        <Icon name={crewIds.includes(person.id) ? "check" : "plus"} />
        {crewIds.includes(person.id) ? "In crew" : "Add to crew"}
      </button>
    </div>
  );
}
