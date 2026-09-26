# PatchScout

PatchScout is a source-grounded autonomous dependency migration agent built for the **Nebius × NVIDIA Global AI Hackathon 2026**.

It is designed around a simple trust rule: **a coding agent should not call a migration fixed until the original verification command passes after the patch.**

## What it does

PatchScout takes a repository URL plus a dependency-upgrade incident and runs a constrained migration loop:

1. **Intake** — capture the repository and observed failure.
2. **Research** — use Tavily to retrieve current migration guides, changelogs, and upstream documentation.
3. **Diagnose** — use NVIDIA Nemotron on Nebius Token Factory to connect the live evidence to the failure.
4. **Patch** — produce the smallest reversible candidate patch.
5. **Verify** — execute the same verification command in an isolated Token Factory Sandbox before marking the migration complete.
6. **Rollback** — keep a pre-patch checkpoint so a failed branch can be discarded without contaminating the baseline.

The UI exposes the full reasoning trace, evidence links, proposed diff, test evidence, rollback plan, and confidence rather than returning an opaque "fixed" message.

## Hackathon tracks

PatchScout is aimed primarily at:

- **Coding & Agentic Engineering** — autonomous code migration and verification.
- **Best Apps & Agents** — a practical developer tool powered by NVIDIA open models.
- **Best Use of Tavily** — live web evidence is part of the agent's safety contract, not an optional search box.

## Stack

- Next.js 16 / React 19 / TypeScript
- NVIDIA Nemotron 3 Super via Nebius Token Factory
- Tavily Search API
- Nebius Token Factory Sandboxes / ConTree execution model
- Official `contree-client` JavaScript SDK

Default model:

```
nvidia/nemotron-3-super-120b-a12b
```

Token Factory OpenAI-compatible endpoint:

```
https://api.tokenfactory.nebius.com/v1/chat/completions
```

## Demo mode vs live mode

PatchScout deliberately distinguishes demo evidence from live execution.

### Demo mode

Demo mode is the default when API credentials are absent. It renders a clearly labeled, deterministic Express 4 → Express 5 migration transcript so the product can be evaluated without pretending an external model or sandbox ran.

### Live mode

Live mode requires a Nebius Token Factory key. Tavily Search can run in official keyless mode; `TAVILY_API_KEY` is optional and used when available:

```bash
PATCHSCOUT_MODE=live
NEBIUS_API_KEY=...
TAVILY_API_KEY=...
```

In live mode, Tavily research and Nemotron diagnosis use real external services. Token Factory Sandboxes access is active for the verified hackathon environment, and PatchScout executes the repository in isolated branchable microVM checkpoints using the official `contree-client` SDK.

## Local development

```bash
npm install
npm run dev
```

Production verification:

```bash
npm run build
npm run lint
npm run start
```

## Environment

Copy `.env.example` to `.env.local`.

```bash
PATCHSCOUT_MODE=demo
NEBIUS_API_KEY=
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1
NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b
NEBIUS_PROJECT_ID=
TAVILY_API_KEY=
NEBIUS_SANDBOX_BASE_URL=https://api.tokenfactory.nebius.com/sandboxes
OUTBOUND_PROXY_URL=
```

Set `PATCHSCOUT_MODE=live` after the Nebius key is configured. A Tavily key is recommended for stable production research; keyless mode remains a fallback. `OUTBOUND_PROXY_URL` is optional and only needed on local machines whose Node runtime requires an explicit outbound proxy.

## API

### POST `/api/agent`

Request:

```json
{
  "repoUrl": "https://github.com/example/repository",
  "incident": "Describe the dependency upgrade failure, stack trace, behavior to preserve, and verification command."
}
```

Response includes:

- live/demo mode
- model
- root-cause diagnosis
- evidence-backed patch plan
- unified diff
- verification tests
- rollback strategy
- confidence
- source URLs
- agent stage trace

## Verification status

Current local checks:

- `npm run build` — PASS
- `npm run lint` — PASS
- production homepage — HTTP 200
- demo `/api/agent` — PASS

Live end-to-end verification is complete on the public Express 5 fixture: PatchScout reproduced the failing baseline in Token Factory Sandboxes (exit 1), applied the structured edit to `src/app.js`, reran the same `npm test` command, and obtained exit 0. See [E2E_PROOF.md](./E2E_PROOF.md).

## Design principle

PatchScout separates **reasoning** from **proof**.

A model may propose a diagnosis. It cannot declare its own patch correct. Only executable verification can do that.

## License

MIT

## Live deployment

- Demo: https://patchscout-five.vercel.app/
- Public fixture: https://github.com/zhaofeipeter/patchscout-fixture-express5
- Production E2E: live Tavily + NVIDIA Nemotron + Nebius Token Factory Sandbox, baseline exit 1 -> patched exit 0, same npm test command.
