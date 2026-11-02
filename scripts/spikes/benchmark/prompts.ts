// T13 spike: the fixed prompt set. The offer is synthetic (fictional company, no personal data);
// it is long to stress prompt processing, and its skill names repeat so ngram-mod can copy them.

const SKILLS = (
  "TypeScript,Node.js,Bun,React,PostgreSQL,Redis,Kafka,Docker,Kubernetes,Terraform,AWS,GraphQL," +
  "gRPC,Rust,Go,OpenTelemetry,Grafana,Playwright,Vitest,GitHub Actions,SQLite,Linux,Nginx,WebSockets"
).split(",");

const duties = SKILLS.map(
  (skill, index) =>
    `- ${skill}: design, build and operate the ${skill} parts of our platform in production, ` +
    `review pull requests that touch ${skill}, write tests for them and help teammates learn ` +
    `${skill}. Expected level: ${["basic", "solid", "expert"][index % 3]}.`,
);

const OFFER = [
  "Senior Backend Engineer - Northwind Parcel Labs (fictional company)",
  "Location: Remote within the EU, with an optional office in Valencia, Spain.",
  "Contract: permanent, full time. Salary: 58,000 to 72,000 EUR gross per year.",
  "About us: Northwind Parcel Labs builds routing software for small courier companies. " +
    "We are 40 people, 15 of them engineers, and we ship to production several times a day.",
  "What you will do:",
  ...duties,
  "What we offer: 25 days of holidays, a yearly learning budget of 1,500 EUR, a laptop of " +
    "your choice, flexible hours and two team meetups per year.",
  "Process: a 30-minute call, a take-home exercise of at most three hours, a technical " +
    "interview about the exercise and a final talk with the team.",
].join("\n");

export const PROMPTS = {
  offer:
    "Read the job offer between the markers and extract it as JSON with the keys title, " +
    "company, location, remote, salary_min, salary_max, currency and skills (an array of " +
    "{name, level}). Reply with the JSON only.\n<<<OFFER\n" +
    `${OFFER}\nOFFER>>>\nJSON:\n`,
  short: "Question: Why does test-driven development help a small team? Answer:",
} as const;

export const N_PREDICT = 256;
export const SEED = 42;
export const RUNS = 3;
