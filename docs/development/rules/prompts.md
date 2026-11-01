# Prompt and agent rules

## Where prompts live

Prompts are versioned files in the root `prompts/` folder, loaded by the app. They are never inlined in code. Every prompt change is measured with the eval set before it is kept.

## Language

Prompt instructions are in English. User-facing replies follow the UI language, with the shared personality (Rioplatense Spanish with voseo when the UI is Spanish). Subagents that do not talk to the user have no personality: data only.

## Prompt order (prefix caching)

1. Role, fixed rules and output format (identical bytes on every call).
2. Approved Learner rules.
3. Stable task context (for the Analytic: rubric, profile and preferences).
4. The variable data last (the offer, the user's message).

Lazily loaded skills, tools and context are appended after the stable prefix. A tool, once loaded, stays loaded for the session.

## Agent contract

- Subagents start with a clean context and receive only IDs; they share data through the database, never by talking to each other.
- Structured output uses a JSON schema; the Validator checks it and returns the exact compact error to the agent, which retries at most twice.
- Code computes scores, weights, verdicts and counts; models judge and write.
- Every item that claims something about the CV carries a verbatim `evidence` quote.
- Sampling parameters are sent on every request from the sampling profiles table; locked profiles are never changed outside a release.
