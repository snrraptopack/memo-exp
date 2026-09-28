export default function LazyBadge() {
  return (
    <p>
      <strong>lazy chunk mounted</strong> — this component's code loaded on
      demand through a Suspense boundary.
    </p>
  );
}
