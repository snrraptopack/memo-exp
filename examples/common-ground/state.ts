import { people, briefs, starterTasks, type Brief } from "./data";

interface SavedSession {
  crew: string[];
  saved: string[];
  brief: Brief;
  launched: boolean;
  completed: string[];
}
function restore(): SavedSession {
  try {
    const value = JSON.parse(
      localStorage.getItem("common-ground-v1") ?? "null",
    );
    if (
      value &&
      Array.isArray(value.crew) &&
      Array.isArray(value.saved) &&
      value.brief &&
      typeof value.brief.name === "string" &&
      typeof value.brief.description === "string" &&
      Array.isArray(value.brief.skills) &&
      value.brief.skills.every((skill: unknown) => typeof skill === "string") &&
      Number.isFinite(value.brief.budget)
    ) {
      return {
        crew: value.crew
          .filter((id: string) => people.some((p) => p.id === id))
          .slice(0, 4),
        saved: value.saved.filter((id: string) =>
          people.some((p) => p.id === id),
        ),
        brief: value.brief,
        launched: value.launched === true,
        completed: Array.isArray(value.completed)
          ? value.completed.filter((id: string) =>
              starterTasks.some((task) => task.id === id),
            )
          : [],
      };
    }
  } catch {
    /* Storage may be unavailable; the app still works in memory. */
  }
  return {
    crew: ["kwame"],
    saved: ["ama"],
    brief: briefs[0]!,
    launched: false,
    completed: [],
  };
}
export let crewIds: string[] = [];
export let savedIds: string[] = [];
export let brief: Brief = {
  name: "",
  description: "",
  skills: [],
  budget: 1200,
};
export let launched = false;
export let completedIds: string[] = [];
export function restoreSession() {
  const initial = restore();
  crewIds = initial.crew;
  savedIds = initial.saved;
  brief = initial.brief;
  launched = initial.launched;
  completedIds = initial.completed;
}
export let notice = "";
export let view = "discover";
export let profileId = "";
function persist() {
  try {
    localStorage.setItem(
      "common-ground-v1",
      JSON.stringify({
        crew: crewIds,
        saved: savedIds,
        brief,
        launched,
        completed: completedIds,
      }),
    );
  } catch {
    /* Browser storage is optional. */
  }
}
export function selectView(next: string) {
  view = next;
}
export function toggleSaved(id: string) {
  savedIds = savedIds.includes(id)
    ? savedIds.filter((value) => value !== id)
    : [...savedIds, id];
  persist();
}
export function addToCrew(id: string) {
  if (crewIds.includes(id)) {
    notice = "Already in your crew. Good taste!";
    return;
  }
  if (crewIds.length >= 4) {
    notice = "Keep it focused: your crew has room for four people.";
    return;
  }
  const person = people.find((value) => value.id === id);
  if (!person?.available) {
    notice =
      "This collaborator is booked right now. Save their profile for later.";
    return;
  }
  crewIds = [...crewIds, id];
  launched = false;
  notice = `${person.name.split(" ")[0]} joined your crew.`;
  persist();
}
export function removeFromCrew(id: string) {
  crewIds = crewIds.filter((value) => value !== id);
  launched = false;
  persist();
}
export function useBrief(index: number) {
  brief = briefs[index]!;
  launched = false;
  completedIds = [];
  persist();
}
export function createBrief(
  name: string,
  description: string,
  discipline: string,
  budget: number,
) {
  brief = {
    name,
    description,
    skills:
      discipline === "Community"
        ? ["Community", "Research", "Frontend"]
        : discipline === "Brand"
          ? ["Art direction", "Brand strategy", "Storytelling"]
          : ["Product design", "Frontend", "Brand strategy"],
    budget,
  };
  launched = false;
  completedIds = [];
  notice = "Your new project is ready for a little good company.";
  persist();
}
export function launchCrew() {
  if (crewIds.length < 2) {
    notice = "Add at least two collaborators to start your project.";
    return;
  }
  launched = true;
  view = "studio";
  notice = "Your project is live. Make something good together.";
  persist();
}
export function toggleTask(id: string) {
  completedIds = completedIds.includes(id)
    ? completedIds.filter((value) => value !== id)
    : [...completedIds, id];
  persist();
}
export function openProfile(id: string) {
  profileId = id;
  openDialog("person-dialog");
}
export function openDialog(id: string) {
  const dialog = document.getElementById(id) as HTMLDialogElement | null;
  if (dialog && !dialog.open) dialog.showModal();
}
export function closeDialog(id: string) {
  (document.getElementById(id) as HTMLDialogElement | null)?.close();
}
export function clearNotice() {
  notice = "";
}
export function resetSession() {
  crewIds = ["kwame"];
  savedIds = ["ama"];
  brief = briefs[0]!;
  completedIds = [];
  launched = false;
  view = "discover";
  notice = "A fresh start. Your next good idea is waiting.";
  persist();
}
