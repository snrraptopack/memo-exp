import { fieldValue } from "../dom";
import { people, briefs } from "../data";
import {
  profileId,
  crewIds,
  savedIds,
  addToCrew,
  toggleSaved,
  closeDialog,
  createBrief,
  useBrief,
  resetSession,
} from "../state";
import { Dialog, Icon } from "./ui";
function BriefForm() {
  let name = "";
  let description = "";
  let discipline = "Product";
  let budget = 1200;
  let error = "";
  const submit = (event: Event) => {
    event.preventDefault();
    if (name.trim().length < 3) {
      error = "Give your project a name of at least three characters.";
      return;
    }
    if (description.trim().length < 12) {
      error = "Tell your crew a little more: at least twelve characters.";
      return;
    }
    createBrief(name.trim(), description.trim(), discipline, budget);
    closeDialog("brief-dialog");
    name = "";
    description = "";
    error = "";
  };
  return (
    <div>
      <div class="dialog-top">
        <span class="eyebrow">BIG IDEAS START SMALL</span>
        <button
          class="icon-button"
          aria-label="Close project brief"
          onClick={() => closeDialog("brief-dialog")}
        >
          <Icon name="close" />
        </button>
      </div>
      <h2>
        What do you want
        <br />
        to make <span>possible?</span>
      </h2>
      <p class="dialog-description">
        A few words. A little direction. The right people will bring the rest.
      </p>
      <form class="brief-form" onSubmit={submit}>
        <label>
          Give your idea a name
          <input
            id="project-name"
            value={name}
            onInput={(e: Event) => {
              name = fieldValue(e);
              error = "";
            }}
            placeholder="A brilliant little idea…"
            maxlength="80"
            required
          />
        </label>
        <label>
          Tell us the story
          <textarea
            id="project-description"
            value={description}
            onInput={(e: Event) => {
              description = fieldValue(e);
              error = "";
            }}
            placeholder="What are you building, and who is it for?"
            rows="3"
            maxlength="300"
            required
          ></textarea>
        </label>
        <div class="form-two-columns">
          <label>
            Your direction
            <select
              value={discipline}
              onChange={(e: Event) => {
                discipline = fieldValue(e);
              }}
            >
              <option>Product</option>
              <option>Brand</option>
              <option>Community</option>
            </select>
          </label>
          <label>
            Daily team budget (GH₵)
            <input
              type="number"
              min="300"
              max="10000"
              step="50"
              value={budget}
              onInput={(e: Event) => {
                budget = Number(fieldValue(e));
              }}
              required
            />
          </label>
        </div>
        {error && (
          <p class="form-error" role="alert">
            {error}
          </p>
        )}
        <button class="button primary" type="submit">
          Create your project <Icon name="arrow" />
        </button>
      </form>
      <div class="starter-ideas">
        <span class="tiny-label">OR BORROW A LITTLE INSPIRATION</span>
        {briefs.map((idea, index) => (
          <button
            key={idea.name}
            onClick={() => {
              useBrief(index);
              closeDialog("brief-dialog");
            }}
          >
            <span>{idea.name}</span>
            <Icon name="arrow" />
          </button>
        ))}
      </div>
    </div>
  );
}
function ProfileContent() {
  const person = people.find((value) => value.id === profileId);
  return (
    <div>
      {person && (
        <div>
          <div class="dialog-top">
            <span class="eyebrow">A LITTLE MORE ABOUT</span>
            <button
              class="icon-button"
              aria-label="Close profile"
              onClick={() => closeDialog("person-dialog")}
            >
              <Icon name="close" />
            </button>
          </div>
          <div class={`profile-portrait ${person.color}`}>
            <img src={person.portrait} alt="" />
            <span class="profile-monogram">{person.initials}</span>
          </div>
          <h2>{person.name}</h2>
          <p class="profile-role">
            {person.role} · {person.city}
          </p>
          <p class="profile-bio">{person.bio}</p>
          <div class="skill-tags">
            {person.skills.map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
          <div class="past-project">
            <span class="tiny-label">SOMETHING I'M PROUD OF</span>
            <h3>{person.project}</h3>
            <p>A little window into the kind of work I love.</p>
          </div>
          <div class="profile-actions">
            <button
              class="button primary"
              disabled={crewIds.includes(person.id) || !person.available}
              onClick={() => {
                addToCrew(person.id);
                closeDialog("person-dialog");
              }}
            >
              {crewIds.includes(person.id)
                ? "Already in your crew"
                : person.available
                  ? "Make something together"
                  : "Available next month"}
              <Icon name="plus" />
            </button>
            <button
              class="button secondary"
              onClick={() => toggleSaved(person.id)}
            >
              <Icon name="bookmark" />
              {savedIds.includes(person.id) ? "Saved" : "Save profile"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export function AppDialogs() {
  return (
    <div>
      <Dialog id="brief-dialog" title="Create a project">
        <BriefForm />
      </Dialog>
      <Dialog id="person-dialog" title="Collaborator profile">
        <ProfileContent />
      </Dialog>
      <Dialog id="about-dialog" title="How Common Ground works">
        <div class="dialog-top">
          <span class="eyebrow">THE COMMON GROUND WAY</span>
          <button
            class="icon-button"
            aria-label="Close how it works"
            onClick={() => closeDialog("about-dialog")}
          >
            <Icon name="close" />
          </button>
        </div>
        <h2>
          Good alone.
          <br />
          <span>Great together.</span>
        </h2>
        <div class="how-steps">
          <div>
            <span>01</span>
            <h3>Start with a spark.</h3>
            <p>
              Give your project a name, a direction, and a daily team budget.
            </p>
          </div>
          <div>
            <span>02</span>
            <h3>Find your kind of different.</h3>
            <p>
              Explore six fictional collaborators. Mix skills, save profiles,
              and build a crew of up to four.
            </p>
          </div>
          <div>
            <span>03</span>
            <h3>Make a little progress.</h3>
            <p>
              Launch your shared workspace and work through your first three
              milestones.
            </p>
          </div>
        </div>
        <div class="local-note">
          <Icon name="globe" />
          <p>
            This is a playground, not a hiring service. Your crew and project
            are saved only in this browser. No sign-up. No messages sent.
          </p>
        </div>
        <button
          class="text-button"
          onClick={() => {
            resetSession();
            closeDialog("about-dialog");
          }}
        >
          Reset this playground <Icon name="arrow" />
        </button>
      </Dialog>
    </div>
  );
}
