# Security policy

goop handles personal data (CVs, chat history) and runs local model servers, so security reports are welcome and taken seriously.

## Supported versions

goop is in early development. Only the latest commit on `main` receives security fixes.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub's **Report a vulnerability** button on the repository's Security tab (private vulnerability reporting).

Include:
- What is affected and how to reproduce it.
- The impact you expect (data exposure, code execution, prompt injection, ...).
- Any suggested fix, if you have one.

You will get an acknowledgement within 7 days. Fixes are released as soon as they are verified, and the report is credited unless you prefer otherwise.

## Scope

In scope: the goop application, its daemon and IPC, the model download and verification, the generated llama-server and llama-swap configuration, the prompts and the quantization tooling in this repository.

Out of scope: vulnerabilities in third-party projects (llama.cpp, llama-swap, model weights, Bun); please report those upstream.
