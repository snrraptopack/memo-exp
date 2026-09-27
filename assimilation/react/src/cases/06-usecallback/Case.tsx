import { useCallback, useState } from 'react';

export function UseCallbackStep() {
  const [step, setStep] = useState(1);
  const [count, setCount] = useState(0);

  const advance = useCallback(() => setCount((c) => c + step), [step]);

  return (
    <section>
      <h2>useCallback — dep-driven closure</h2>
      <p>
        count: <span data-testid="count">{count}</span>, step:{' '}
        <span data-testid="step">{step}</span>
      </p>
      <button onClick={advance}>+ step</button>
      <button onClick={() => setStep((s) => s + 1)}>raise step</button>
      <button onClick={() => setStep(1)}>reset step</button>
    </section>
  );
}
