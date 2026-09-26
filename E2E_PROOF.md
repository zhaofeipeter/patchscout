# PatchScout live end-to-end proof

Verified locally on 2026-09-26 against the public fixture:

- Fixture: https://github.com/zhaofeipeter/patchscout-fixture-express5
- Verification command: `npm test`
- Research: real Tavily API, with official Express sources ranked first
- Reasoning: NVIDIA Nemotron 3 Super on Nebius Token Factory
- Execution: Nebius Token Factory Sandboxes / ConTree
- Baseline exit: **1**
- Patched exit: **0**
- Final test status: **passed**

The verified structured edit was:

```diff
--- a/src/app.js
+++ b/src/app.js
@@ structured replacement @@
- app.all("*", fallbackHandler);
+ app.all("{*splat}", fallbackHandler);
```

The baseline sandbox run failed during Express 5 route registration with `Missing parameter name`. PatchScout applied the candidate on a branchable sandbox checkpoint and reran the exact same `npm test` command. The patched run exited 0.

The project intentionally does **not** let the model mark its own work verified. Verification is derived from executable fail-before / pass-after evidence.

## Production deployment proof

- Live demo: https://patchscout-five.vercel.app/
- Production API mode: live
- Sandbox status: executed
- Baseline exit: 1
- Patched exit: 0
- Final verification: npm test passed
