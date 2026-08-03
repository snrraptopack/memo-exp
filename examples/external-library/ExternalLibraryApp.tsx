import { animate } from 'animejs';

export function ExternalLibraryApp() {
  const hidden = { value: 0 };
  const callback = { value: 0 };
  const effectValue = { value: 0 };
  let callbackSample = 0;
  let hiddenRunCount = 0;
  let callbackRunCount = 0;
  let effectRunCount = 0;

  effect(() => {
    if (effectRunCount === 0) return;
    animate(effectValue, {
      value: 100,
      duration: 800,
      ease: 'linear',
    });

    console.log(effectValue)
  });

  function startHiddenAnimation() {
    hidden.value = 0;
    hiddenRunCount++;

    animate(hidden, {
      value: 100,
      duration: 800,
      ease: 'linear',
    });
  }

  function startCallbackAnimation() {
    callback.value = 0;
    callbackSample = 0;
    callbackRunCount++;

    animate(callback, {
      value: 100,
      duration: 800,
      ease: 'linear',
      onUpdate: () => {
        callbackSample = Math.round(callback.value);
      },
    });
  }

  function startEffectAnimation() {
    effectValue.value = 0;
    effectRunCount++;
  }

  return (
    <main class="external-library-app">
      <p class="eyebrow">External package interoperability probe</p>
      <h1>Anime.js hidden mutation test</h1>
      <p>
        Test the callback-free animation first. Then test the animation that
        copies its current value into component state from onUpdate.
      </p>

      <div class="actions">
        <button id="start-hidden-animation" onClick={startHiddenAnimation}>
          Start callback-free animation
        </button>
        <button id="start-callback-animation" onClick={startCallbackAnimation}>
          Start onUpdate animation
        </button>
        <button id="start-effect-animation" onClick={startEffectAnimation}>
          Start callback-free animation from effect
        </button>
      </div>

      <dl>
        <div>
          <dt>Callback-free runs</dt>
          <dd id="hidden-run-count">{hiddenRunCount}</dd>
        </div>
        <div>
          <dt>onUpdate runs</dt>
          <dd id="callback-run-count">{callbackRunCount}</dd>
        </div>
        <div>
          <dt>Effect-started runs</dt>
          <dd id="effect-run-count">{effectRunCount}</dd>
        </div>
        <div>
          <dt>Hidden external object value</dt>
          <dd id="hidden-value">{Math.round(hidden.value)}</dd>
        </div>
        <div>
          <dt>External callback object value</dt>
          <dd id="callback-value">{Math.round(callback.value)}</dd>
        </div>
        <div>
          <dt>Component value written by onUpdate</dt>
          <dd id="callback-sample">{callbackSample}</dd>
        </div>
        <div>
          <dt>Callback-free value started from effect</dt>
          <dd id="effect-value">{Math.round(effectValue.value)}</dd>
        </div>
      </dl>

    </main>
  );
}
