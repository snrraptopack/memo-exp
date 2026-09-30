import { people, starterTasks } from "../data";
import {
  brief,
  crewIds,
  launched,
  completedIds,
  toggleTask,
  selectView,
  launchCrew,
} from "../state";
import { Icon, Section } from "./ui";
import { CrewPanel } from "./CrewPanel";
export function Studio() {
  const crew = people.filter((person) => crewIds.includes(person.id));
  const progress = Math.round(
    (completedIds.length / starterTasks.length) * 100,
  );
  return (
    <div class="studio-page">
      <div class="studio-heading">
        <div>
          <p class="eyebrow">YOUR SHARED SPACE</p>
          <h1>
            A good idea.
            <br />
            <span>Even better company.</span>
          </h1>
        </div>
        <span class={launched ? "studio-status live" : "studio-status"}>
          <i></i>
          {launched ? "Project is live" : "A work in possibility"}
        </span>
      </div>
      <div class="studio-layout">
        <div>
          <div class="studio-project">
            <div>
              <span class="tiny-label">YOUR NEXT BIG THING</span>
              <h2>{brief.name}</h2>
              <p>{brief.description}</p>
            </div>
            <div class="project-emblem">
              <Icon name="spark" />
            </div>
          </div>
          <Section
            eyebrow="ONE SMALL STEP AT A TIME"
            title="From possibility to progress"
            action={<span class="progress-label">{progress}% there</span>}
          >
            <div class="task-list">
              {starterTasks.map((task) => (
                <label
                  key={task.id}
                  class={
                    completedIds.includes(task.id)
                      ? "task-row done"
                      : "task-row"
                  }
                >
                  <input
                    type="checkbox"
                    checked={completedIds.includes(task.id)}
                    disabled={!launched}
                    onChange={() => toggleTask(task.id)}
                  />
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.note}</span>
                  </div>
                  <span class="task-number">
                    {completedIds.includes(task.id) ? "✓" : "↗"}
                  </span>
                </label>
              ))}
            </div>
            {!launched && (
              <p class="task-hint">
                Launch your crew to unlock your shared project checklist.
              </p>
            )}
            {progress === 100 && (
              <div class="success-note">
                <Icon name="spark" />
                <div>
                  <strong>Look what you made possible.</strong>
                  <span>
                    Your first chapter is complete. Here's to the next one.
                  </span>
                </div>
              </div>
            )}
          </Section>
          <Section
            eyebrow="DIFFERENT MINDS, ONE DIRECTION"
            title="The people behind the possibility"
          >
            <div class="studio-people">
              {crew.map((person) => (
                <div key={person.id} class="studio-person">
                  <img src={person.portrait} alt="" />
                  <div>
                    <strong>{person.name}</strong>
                    <span>{person.role}</span>
                  </div>
                  <span class="badge">{person.discipline}</span>
                </div>
              ))}
            </div>
            {crew.length === 0 && (
              <p class="empty-copy">Your story needs its first collaborator.</p>
            )}
          </Section>
          <div class="studio-bottom">
            <button
              class="button secondary"
              onClick={() => selectView("discover")}
            >
              Find more good company <Icon name="arrow" />
            </button>
            {!launched && crew.length >= 2 && (
              <button class="button primary" onClick={() => launchCrew()}>
                Launch this crew <Icon name="spark" />
              </button>
            )}
          </div>
        </div>
        <CrewPanel
          footer={
            <span class="panel-note">
              Small enough to care. Different enough to surprise you.
            </span>
          }
        />
      </div>
    </div>
  );
}
