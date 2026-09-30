import { people } from "../data";
import { Icon } from "./ui";
import { brief, crewIds, openDialog, selectView } from "../state";
export function Hero() {
  return (
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <div class="hero-eyebrow">
          <span>NEW</span> YOUR NEXT GOOD IDEA STARTS HERE
        </div>
        <h1 id="hero-title">
          Find your people.
          <br />
          Build something <span>great.</span>
        </h1>
        <p>
          Different skills. Shared ambition. Meet independent minds and put your
          next big idea in good company.
        </p>
        <div class="hero-actions">
          <button
            class="button primary"
            onClick={() => openDialog("brief-dialog")}
          >
            Start with an idea <Icon name="arrow" />
          </button>
          <button class="text-button" onClick={() => selectView("studio")}>
            Meet your crew <Icon name="chevron" />
          </button>
        </div>
        <div class="social-proof">
          <div class="mini-avatars">
            <img src={people[0]!.portrait} alt="" />
            <img src={people[1]!.portrait} alt="" />
            <img src={people[2]!.portrait} alt="" />
          </div>
          <span>
            Small teams.
            <br />
            <strong>Extraordinary possibilities.</strong>
          </span>
        </div>
      </div>
      <div
        class="hero-art"
        aria-label="A shared idea brings different people together"
      >
        <div class="sun-disc"></div>
        <div class="art-blue">
          <span class="art-caption">
            THE NEXT BIG THING
            <br />
            IS A TEAM THING.
          </span>
          <svg
            class="art-lines"
            viewBox="0 0 520 320"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M30 100Q160 20 270 160T500 230M20 270Q160 290 260 160T460 60"
              stroke="white"
              stroke-opacity=".24"
              stroke-width="1.5"
              stroke-dasharray="6 8"
            />
            <circle
              cx="260"
              cy="160"
              r="75"
              stroke="white"
              stroke-opacity=".12"
            />
          </svg>
        </div>
        <div class="floating-person person-one">
          <img src={people[0]!.portrait} alt="" />
          <div>
            <strong>Ama Boateng</strong>
            <span>Design with a little heart.</span>
          </div>
          <span class="match-dot"></span>
        </div>
        <div class="floating-brief">
          <div class="brief-art-top">
            <span class="tiny-label">YOUR NEXT CHAPTER</span>
            <Icon name="spark" />
          </div>
          <h3>{brief.name}</h3>
          <div class="brief-art-footer">
            <span>
              <i></i> {crewIds.length} collaborator
              {crewIds.length === 1 ? "" : "s"} on board
            </span>
            <button
              aria-label="Open your studio"
              onClick={() => selectView("studio")}
            >
              <Icon name="arrow" />
            </button>
          </div>
        </div>
        <div class="floating-person person-two">
          <img src={people[1]!.portrait} alt="" />
          <div>
            <strong>Kwame Mensah</strong>
            <span>A good idea, brought to life.</span>
          </div>
          <span class="mini-check">
            <Icon name="check" />
          </span>
        </div>
        <div class="art-sticker">
          <Icon name="spark" />
          <span>
            Better
            <br />
            <strong>together.</strong>
          </span>
        </div>
      </div>
    </section>
  );
}
