const paths: Record<string, string> = {
  arrow: "M5 12h14m-5-5 5 5-5 5",
  plus: "M12 5v14M5 12h14",
  check: "m5 12 4 4 10-10",
  close: "m6 6 12 12M6 18 18 6",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  spark: "m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8z",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18",
  chevron: "m9 5 7 7-7 7",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8",
};
export function Icon({ name }: { name: string }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.spark} />
    </svg>
  );
}
export function Badge({ children }: { children: JSX.Child }) {
  return <span class="badge">{children}</span>;
}
export function Section({
  eyebrow,
  title,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  action?: JSX.Child;
  children: JSX.Child;
}) {
  return (
    <section class="section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <div>{action}</div>
      </div>
      {children}
    </section>
  );
}
export function Dialog({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: JSX.Child;
}) {
  return (
    <dialog id={id} aria-label={title} class="dialog">
      <div class="dialog-inner">{children}</div>
    </dialog>
  );
}
