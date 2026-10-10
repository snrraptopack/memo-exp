import { people } from "../data";
import {
  brief,
  crewIds,
  launched,
  removeFromCrew,
  launchCrew,
  openDialog,
} from "../state";
import { Icon } from "./ui";
function CrewMember({ person }: { person: (typeof people)[number] }) {
  return (
    <div class="crew-member" data-crew-person={person.id}>
      <img src={person.portrait} alt="" />
      <div>
        <strong>{person.name}</strong>
        <span>{person.role}</span>
      </div>
      <button
        class="icon-button"
        aria-label={`Remove ${person.name} from crew`}
        onClick={() => removeFromCrew(person.id)}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
export function CrewPanel({ footer }: { footer?: JSX.Child }) {
  const crew = people.filter((person) => crewIds.includes(person.id));
  const requiredSkills = brief.skills;
  const skills = requiredSkills.filter((skill) =>
    crew.some((person) => person.skills.includes(skill)),
  );
  const rate = crew.reduce((sum, person) => sum + person.rate, 0);
  return (
    <aside class="crew-panel" aria-label="Your project crew">
      <div class="crew-heading">
        <div class="crew-heading-icon">
          <Icon name="people" />
        </div>
        <div>
          <h2>Your little dream team</h2>
          <p>Good ideas need good company.</p>
        </div>
        <span>{crewIds.length}/4</span>
      </div>
      <div class="project-summary">
        <span class="tiny-label">THE PROJECT</span>
        <button
          class="icon-button"
          aria-label="Change project brief"
          onClick={() => openDialog("brief-dialog")}
        >
          <Icon name="plus" />
        </button>
        <h3>{brief.name}</h3>
        <p>{brief.description}</p>
      </div>
      <div class="crew-members">
        {crew.map((person) => (
          <CrewMember key={person.id} person={person} />
        ))}
      </div>
      {crewIds.length < 4 && (
        <div class="empty-seat">
          <span>+</span>
          <p>
            A seat for your next
            <br />
            <strong>great collaborator.</strong>
          </p>
        </div>
      )}
      <div class="coverage">
        <div>
          <span>Skill coverage</span>
          <strong>
            {skills.length}/{brief.skills.length}
          </strong>
        </div>
        <div class="coverage-bars">
          {requiredSkills.map((skill) => (
            <span
              key={skill}
              class={skills.includes(skill) ? "covered" : ""}
              title={skill}
            ></span>
          ))}
        </div>
        <div class="coverage-skills">
          {requiredSkills.map((skill) => (
            <span key={skill}>
              <Icon name={skills.includes(skill) ? "check" : "plus"} />
              {skill}
            </span>
          ))}
        </div>
      </div>
      <div class="crew-total">
        <span>Your team's day rate</span>
        <strong>GH₵ {rate}</strong>
      </div>
      <p
        class={rate > brief.budget ? "budget-note over-budget" : "budget-note"}
      >
        {rate > brief.budget
          ? `GH₵ ${rate - brief.budget} over your daily budget`
          : `Within your GH₵ ${brief.budget} daily budget`}
      </p>
      <button
        class="button primary launch-button"
        disabled={crewIds.length < 2}
        onClick={() => launchCrew()}
      >
        {launched ? "Back to your workspace" : "Bring this idea to life"}
        <Icon name="arrow" />
      </button>
      <p class="crew-footnote">
        {crewIds.length < 2
          ? "Add one more person to get started."
          : "Your shared workspace is one click away."}
      </p>
      {footer}
    </aside>
  );
}
