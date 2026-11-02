// T13 spike: the fixed prompt set. The offer is synthetic (fictional company, no personal data);
// it is long to stress prompt processing, and its skill names repeat so ngram-mod can copy them.

const SKILLS = (
  "TypeScript,Node.js,Bun,React,PostgreSQL,Redis,Kafka,Docker,Kubernetes,Terraform,AWS,GraphQL," +
  "gRPC,Rust,Go,OpenTelemetry,Grafana,Playwright,Vitest,GitHub Actions,SQLite,Linux,Nginx,WebSockets"
).split(",");

// Each measured run uses a different offer and question: ngram-mod remembers earlier answers,
// so repeating one prompt would let it draft the whole reply and fake its speed.
const COMPANIES = ["Northwind Parcel Labs", "Bluefin Ledger Systems", "Tidewater Clinic Software"];
const ROLES = ["Senior Backend Engineer", "Platform Engineer", "Staff Data Engineer"];
const CITIES = ["Valencia, Spain", "Lisbon, Portugal", "Utrecht, the Netherlands"];

function offer(variant: number): string {
  const skills = [...SKILLS.slice(variant * 5), ...SKILLS.slice(0, variant * 5)];
  const duties = skills.map(
    (skill, index) =>
      `- ${skill}: design, build and operate the ${skill} parts of our platform in production, ` +
      `review pull requests that touch ${skill}, write tests for them and help teammates learn ` +
      `${skill}. Expected level: ${["basic", "solid", "expert"][(index + variant) % 3]}.`,
  );
  const low = 58_000 + variant * 4_000;
  return [
    `${ROLES[variant]} - ${COMPANIES[variant]} (fictional company)`,
    `Location: Remote within the EU, with an optional office in ${CITIES[variant]}.`,
    `Contract: permanent, full time. Salary: ${low.toLocaleString("en")} to ` +
      `${(low + 14_000).toLocaleString("en")} EUR gross per year.`,
    `About us: ${COMPANIES[variant]} builds software for small companies. ` +
      "We are 40 people, 15 of them engineers, and we ship to production several times a day.",
    "What you will do:",
    ...duties,
    "What we offer: 25 days of holidays, a yearly learning budget of 1,500 EUR, a laptop of " +
      "your choice, flexible hours and two team meetups per year.",
    "Process: a 30-minute call, a take-home exercise of at most three hours, a technical " +
      "interview about the exercise and a final talk with the team.",
  ].join("\n");
}

const extract = (variant: number) =>
  "Read the job offer between the markers and extract it as JSON with the keys title, " +
  "company, location, remote, salary_min, salary_max, currency and skills (an array of " +
  "{name, level}). Reply with the JSON only.\n<<<OFFER\n" +
  `${offer(variant)}\nOFFER>>>\nJSON:\n`;

const QUESTIONS = [
  "Why does test-driven development help a small team?",
  "When should a startup split a monolith into services?",
  "What makes a code review useful instead of slow?",
];

/** One prompt per measured run, for each kind. */
export const PROMPTS = {
  offer: [0, 1, 2].map(extract),
  short: QUESTIONS.map((question) => `Question: ${question} Answer:`),
} as const;

/** Sent once before measuring; never measured. */
export const WARMUP = "Question: What is a unit test? Answer:";

export const N_PREDICT = 256;
export const SEED = 42;
