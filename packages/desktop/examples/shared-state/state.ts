/** Ordinary module state: the compiler supplies reader tables and write routing. */
export const state = {
  count: 0,
  title: 'One state module, two readers',
};

// The shared kernel recomputes this before either presentation reader runs.
export const doubled = state.count * 2;

export function increment(): void {
  state.count++;
}

export function decrement(): void {
  state.count--;
}

export function rename(title: string): void {
  state.title = title;
}

export function incrementLater(): void {
  // This callback retains its application scope. No click event is needed
  // when the delayed write routes back through the shared kernel.
  setTimeout(() => {
    state.count++;
  }, 500);
}

/** Each side of await publishes without waiting for the whole handler to end. */
export async function incrementInPhases(): Promise<void> {
  state.count++;

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 500);
  });

  state.count++;
}
