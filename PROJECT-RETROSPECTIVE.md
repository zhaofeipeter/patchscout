# PatchScout Project Retrospective

## Delivery outcome

PatchScout was built, tested, deployed, and submitted to the Nebius x NVIDIA Global AI Hackathon.

Final evidence:
- Devpost submission: https://devpost.com/software/patchscout
- Live app: https://patchscout-five.vercel.app/
- Source: https://github.com/zhaofeipeter/patchscout
- Demo video: https://youtu.be/XOSVHTOCFdc
- GitHub CI: passing
- Production E2E: Tavily -> NVIDIA Nemotron on Nebius Token Factory -> Token Factory Sandbox
- Verified transition on the public Express 5 fixture: baseline `npm test` exit 1 -> patched `npm test` exit 0

## Could AI Company OS complete this independently?

Not fully in its current form, but most of the delivery path is automatable once external accounts and credentials are available.

The coding, repository inspection, debugging, testing, CI, GitHub push, deployment, production verification, documentation, demo preparation, and Devpost form population were completed without repeated human decision-making.

The remaining intentionally human-gated boundaries are:
- payment/card authorization and 3D Secure;
- platform-enforced identity or 2FA verification;
- explicit legal acceptance where the user's consent is required.

Everything else should be treated as an automation responsibility.

## Capabilities demonstrated

1. Hackathon qualification and project selection.
2. Browser-profile isolation and account-policy enforcement.
3. Third-party onboarding for Nebius, Tavily, Vercel, YouTube, GitHub, and Devpost.
4. Next.js / React / TypeScript product development.
5. Live NVIDIA Nemotron inference through Nebius Token Factory.
6. Live Tavily research with official-source prioritization.
7. Repository inspection from GitHub and npm metadata.
8. Structured code-edit generation and deterministic patch application.
9. Isolated execution with Token Factory Sandboxes / ConTree.
10. Fail-before / pass-after verification using the exact same test command.
11. Bounded autonomous repair after a failed candidate.
12. Production deployment, live E2E, demo video production, and Devpost submission.

## Gaps for future automation

### Remote connection durability
Remote Desktop Commander disconnected multiple times. Future automation needs durable continuation, automatic reconnect, checkpoint recovery, and idempotent step resumption.

### Browser UI reliability
Third-party forms exposed inconsistent accessibility patterns. The robust fallback order is semantic control invocation -> keyboard interaction -> coordinate click, followed by explicit state verification.

### Secure credential transfer
Direct secret extraction was correctly blocked. The safe pattern is local UI-to-UI copy/paste with secrets never entering chat or logs. A first-class secure clipboard handoff would remove unnecessary user involvement.

### External onboarding adapters
Reusable adapters are needed for:
- account creation/login;
- API key creation;
- OAuth and GitHub App authorization;
- free-plan/credit activation;
- deployment;
- video upload;
- hackathon form submission.

### Long-running execution
Sandbox and live agent runs can exceed one minute. The route limit had to be raised from 60 to 300 seconds. Future orchestration should use durable jobs, stage timeouts, polling, and resumable state.

### Model-output reliability
Nemotron occasionally returned no usable edits. The successful mitigation pattern was:
- structured JSON output;
- real repository context;
- exact `path/search/replace` edits;
- retry on empty edit plans;
- bounded repair using real test output.

## Avoidable human interventions

These should not require the user in future:
- copying API keys;
- ordinary registration choices;
- selecting known profile/country fields;
- GitHub/Vercel repository authorization;
- choosing free plans;
- uploading demo video;
- completing Devpost fields;
- creating/pushing repositories;
- running build/lint/E2E checks.

## Legitimate human boundaries

Human involvement may still be required for:
- payment/card authorization;
- platform-enforced identity or 2FA verification;
- explicit legal consent to contest rules or terms.

Automation should stop only at those boundaries, request the smallest possible action, and resume immediately.

## Reusable delivery pipeline

```
select project
  -> inspect real repository
  -> retrieve current authoritative evidence
  -> model proposes structured edits
  -> isolated baseline execution
  -> apply edit on reversible checkpoint
  -> rerun exact verification
  -> bounded repair if needed
  -> deploy
  -> production E2E
  -> prepare demo/submission
  -> verify public deliverables
  -> write retrospective
```

This project provides concrete evidence for what a future autonomous delivery system must support, without requiring further AI Company OS development now.
