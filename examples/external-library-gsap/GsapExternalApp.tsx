import { gsap } from 'gsap';

export function GsapExternalApp() {
  let stage: HTMLElement | undefined;
  let timeline: gsap.core.Timeline | undefined;
  const externalTarget = { value: 0, angle: 0 };
  let runCount = 0;

  cleanup(() => {
    timeline?.kill();
    gsap.killTweensOf(externalTarget);
  });

  function startAnimation() {
    timeline?.kill();
    externalTarget.value = 0;
    externalTarget.angle = 0;
    runCount++;

    const cards = stage?.querySelectorAll('.gsap-card') ?? [];
    gsap.set(cards, { clearProps: 'all' });

    // No update/completion callbacks: GSAP owns every later write internally.
    timeline = gsap.timeline();
    timeline
      .to(externalTarget, {
        value: 100,
        angle: 360,
        duration: 1.6,
        ease: 'none',
      }, 0)
      .fromTo(cards, {
        x: -80,
        opacity: 0.2,
        rotation: -12,
      }, {
        x: 0,
        opacity: 1,
        rotation: 0,
        duration: 0.7,
        stagger: 0.14,
        ease: 'back.out(1.7)',
      }, 0)
      .to(cards, {
        y: -18,
        duration: 0.35,
        stagger: 0.1,
        repeat: 1,
        yoyo: true,
        ease: 'power2.inOut',
      }, 0.85);
  }

  function pauseAnimation() {
    timeline?.pause();
  }

  function resumeAnimation() {
    timeline?.resume();
  }

  function reverseAnimation() {
    timeline?.reverse();
  }

  return (
    <main class="external-library-app">
      <p class="eyebrow">Independent external package probe</p>
      <h1>GSAP callback-free mutation test</h1>
      <p>
        This component imports only GSAP. The animation mutates an ordinary
        JavaScript object and real DOM nodes without update callbacks or a
        framework adapter. Its timeline is disposed through cleanup().
      </p>

      <div class="actions">
        <button id="start-gsap-animation" onClick={startAnimation}>
          Start / restart
        </button>
        <button id="pause-gsap-animation" onClick={pauseAnimation}>Pause</button>
        <button id="resume-gsap-animation" onClick={resumeAnimation}>Resume</button>
        <button id="reverse-gsap-animation" onClick={reverseAnimation}>Reverse</button>
      </div>

      <section class="stage" ref={stage}>
        <article class="gsap-card">Compiler</article>
        <article class="gsap-card">Runtime</article>
        <article class="gsap-card">Vanilla GSAP</article>
      </section>

      <dl>
        <div>
          <dt>Runs</dt>
          <dd id="gsap-run-count">{runCount}</dd>
        </div>
        <div>
          <dt>Hidden GSAP object value</dt>
          <dd id="gsap-value">{Math.round(externalTarget.value)}</dd>
        </div>
        <div>
          <dt>Hidden object angle</dt>
          <dd id="gsap-angle">{Math.round(externalTarget.angle)}°</dd>
        </div>
        <div>
          <dt>Timeline progress pulled from GSAP</dt>
          <dd id="gsap-progress">
            {timeline ? Math.round(timeline.progress() * 100) : 0}%
          </dd>
        </div>
        <div>
          <dt>Timeline state pulled from GSAP</dt>
          <dd id="gsap-state">
            {!timeline
              ? 'idle'
              : timeline.paused()
                ? 'paused'
                : timeline.progress() === 1
                  ? 'complete'
                  : 'active'}
          </dd>
        </div>
      </dl>
    </main>
  );
}
