const scheduleItems = [
  {
    time: "9:00am",
    title: "Remote opening",
    text: "<strong>tasks released</strong> for remote participants.",
  },
  {
    time: "13:00",
    title: "In-person kick-off",
    text: "Hackathon starts in 6E.",
  },
  {
    time: "15:00-16:00",
    title: "Talk break",
    text: "Break for a talk.",
  },
  {
    time: "17:30",
    title: "Closing ceremony",
    text: "Prize announcements and wrap-up.",
  },
];

const faqItems = [
  {
    question: "What are we collecting?",
    answer:
      "Human solving times for Time Horizons tasks, so estimated task horizons can be replaced with measured baselines.",
  },
  {
    question: "Can remote participants join?",
    answer:
      "Yes. Remote participants can start when the tasks are released at 9:00am PDT.",
  },
  {
    question: "Where is the in-person event?",
    answer:
      "The in-person hackathon starts at 13:00 PDT in 6E.",
  },
  {
    question: "Are the tasks on this page yet?",
    answer:
      "No. This page is only the public event page for now; task delivery should stay separate until launch.",
  },
];

function renderScheduleItem(item) {
  return `
    <article class="schedule-item">
      <p class="schedule-item__time">${item.time} PDT</p>
      <div>
        <h3>${item.title}</h3>
        <p>${item.text}</p>
      </div>
    </article>
  `;
}

function renderFaqItem(item) {
  return `
    <article class="info-card">
      <h3>${item.question}</h3>
      <p>${item.answer}</p>
    </article>
  `;
}

function renderApp() {
  const root = document.getElementById("app-root");
  if (!root) {
    return;
  }

  root.innerHTML = `
    <section class="hero-panel" id="top">
      <div>
        <p class="eyebrow">Time Horizons</p>
        <h1>Time Horizons Hackathon</h1>
        <p class="hero-copy">
          Help collect human solving times for Time Horizons tasks. Remote participants can start
          when tasks open in the morning; the in-person hackathon starts after lunch in 6E.
        </p>
        <div class="inline-actions hero-actions">
          <a class="btn btn--primary" href="#schedule">Schedule</a>
          <a class="btn btn--secondary" href="#faq">FAQ</a>
        </div>
      </div>
      <aside class="hero-panel__status" aria-label="Event summary">
        <figure class="hero-figure">
          <img
            src="./assets/human-time-histogram.png"
            alt="Histogram of human item response times from the physical-only Time Horizons subset"
          >
          <figcaption>Physical-only pilot timings from the current benchmark work.</figcaption>
        </figure>
        <div class="metric-tile">
          <span class="metric-tile__label">Remote Opening</span>
          <strong>9:00am PDT</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-tile__label">In Person</span>
          <strong>13:00 PDT in 6E</strong>
        </div>
        <div class="metric-tile metric-tile--accent">
          <span class="metric-tile__label">Goal</span>
          <strong>Measure human solving times</strong>
        </div>
      </aside>
    </section>

    <section id="overview" class="section-grid">
      <article class="surface-card">
        <div class="surface-card__header">
          <div>
            <p class="surface-card__eyebrow">About</p>
            <h2>Why this hackathon exists</h2>
            <p>
              Time Horizons collects task families meant to measure how difficult tasks are for
              humans and models. Many of those families already have estimated human times, but
              not measured baselines. This event is for filling that gap.
            </p>
          </div>
        </div>
      </article>

      <aside class="surface-card">
        <div class="surface-card__header">
          <div>
            <p class="surface-card__eyebrow">Format</p>
            <h2>What participants do</h2>
            <p>
              Work through assigned tasks, record answers and timing, and help turn estimated
              horizons into measured human baselines.
            </p>
          </div>
        </div>
      </aside>
    </section>

    <section id="schedule" class="surface-card">
      <div class="surface-card__header">
        <div>
          <p class="surface-card__eyebrow">Schedule</p>
          <h2>Hackathon day, PDT</h2>
        </div>
      </div>
      <div class="schedule-list">
        ${scheduleItems.map(renderScheduleItem).join("")}
      </div>
    </section>

    <section id="faq" class="surface-card">
      <div class="surface-card__header">
        <div>
          <p class="surface-card__eyebrow">FAQ</p>
          <h2>Event basics</h2>
        </div>
      </div>
      <div class="feature-grid">
        ${faqItems.map(renderFaqItem).join("")}
      </div>
    </section>
  `;
}

renderApp();
