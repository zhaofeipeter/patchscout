# Devpost submission notes

## Project name
PatchScout

## One-line pitch
A source-grounded autonomous dependency migration agent that researches current upstream docs, proposes the smallest patch with NVIDIA Nemotron, and only calls the migration fixed after the original verification passes in an isolated Nebius sandbox.

## What it does
Dependency migrations fail in a dangerous way: the code model often knows an older API, produces a plausible patch, and then confidently claims success. PatchScout changes the contract.

Given a public repository and a real upgrade incident, PatchScout:
- retrieves current migration guides and changelogs with Tavily;
- asks NVIDIA Nemotron 3 Super on Nebius Token Factory to reason only from the incident plus retrieved evidence;
- prepares a minimal, reversible migration;
- executes on a branchable Token Factory Sandbox checkpoint;
- reruns the same verification command that reproduced the baseline failure;
- reports the evidence, diff, test result, rollback point, and confidence.

## Why it is different
The model never grades its own work. Research, reasoning, execution, and verification are separate stages with a visible chain of custody.

## Built with
- Nebius Token Factory
- NVIDIA Nemotron 3 Super 120B A12B
- Nebius Token Factory Sandboxes / ConTree
- Tavily
- Next.js / React / TypeScript

## Primary track
Coding & Agentic Engineering

## Additional prize fit
Best Use of Tavily

## Current implementation status
The web product, deterministic demo transcript, Tavily adapter, Nemotron adapter, agent trace, build, lint, and production HTTP smoke test are complete. Live sandbox execution is connected only after the Nebius account receives Token Factory Sandboxes beta access; until then PatchScout explicitly labels execution as pending rather than simulating it as live.

## Demo flow
1. Open PatchScout.
2. Load the Express 4 → Express 5 wildcard incident.
3. Run the agent.
4. Show the current-source evidence.
5. Show the Nemotron diagnosis and one-line route patch.
6. Show before/after verification evidence and rollback.
7. Repeat in live mode once Token Factory key + Sandboxes access are active.
