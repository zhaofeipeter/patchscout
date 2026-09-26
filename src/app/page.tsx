"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AgentResult, AgentStep } from "@/lib/types";

const SAMPLE_REPO = "https://github.com/zhaofeipeter/patchscout-fixture-express5";
const SAMPLE_INCIDENT = `Production boot fails immediately after upgrading Express 4 to Express 5.

TypeError: Missing parameter name at 1: https://git.new/pathToRegexpError

The service used app.all("*", fallbackHandler) as a catch-all route. Find the upstream change, propose the smallest safe fix, and verify it with npm test.`;

const stageLabels: Record<AgentStep["stage"], string> = {
  intake: "01",
  research: "02",
  diagnose: "03",
  patch: "04",
  verify: "05",
};

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function Home() {
  const [repoUrl, setRepoUrl] = useState(SAMPLE_REPO);
  const [incident, setIncident] = useState(SAMPLE_INCIDENT);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const completedSteps = useMemo(
    () => result?.steps.filter((step) => step.status === "complete").length ?? 0,
    [result],
  );

  async function runInvestigation(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, incident }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Investigation failed.");
      }
      setResult(payload as AgentResult);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Investigation failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  function loadSample() {
    setRepoUrl(SAMPLE_REPO);
    setIncident(SAMPLE_INCIDENT);
    setError("");
  }

  return (
    <main className="min-h-screen bg-[#07100d] text-[#edf7f1]">
      <div className="noise min-h-screen">
        <header className="mx-auto flex w-full max-w-[1480px] items-center justify-between px-6 py-6 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-300/30 bg-emerald-300/10 font-mono text-sm font-black text-emerald-200">
              PS
            </div>
            <div>
              <div className="text-sm font-semibold tracking-[0.18em] text-emerald-100">
                PATCHSCOUT
              </div>
              <div className="text-xs text-white/40">
                evidence-backed software repair
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs text-white/45 sm:flex">
            <span className="rounded-full border border-white/10 px-3 py-1.5">
              NVIDIA Nemotron
            </span>
            <span className="rounded-full border border-white/10 px-3 py-1.5">
              Nebius Token Factory
            </span>
            <span className="rounded-full border border-white/10 px-3 py-1.5">
              Tavily
            </span>
          </div>
        </header>

        <section className="mx-auto w-full max-w-[1480px] px-6 pb-12 pt-8 lg:px-10 lg:pt-16">
          <div className="mb-10 max-w-5xl">
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.24em] text-emerald-300/70">
              incident → evidence → patch → proof
            </div>
            <h1 className="max-w-5xl text-4xl font-semibold leading-[1.03] tracking-[-0.04em] text-white md:text-6xl lg:text-7xl">
              Stop guessing at production failures.
              <span className="block text-white/45">
                Ship the smallest fix you can prove.
              </span>
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-7 text-white/55 md:text-lg">
              PatchScout researches upstream changes, isolates a causal
              explanation, proposes a minimal diff, and turns verification into
              an auditable evidence pack.
            </p>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
            <form
              onSubmit={runInvestigation}
              className="panel h-fit rounded-[28px] p-5 md:p-7"
            >
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-white">
                    Incident intake
                  </div>
                  <div className="mt-1 text-xs text-white/40">
                    Give PatchScout the repo and the failure, not a prompt recipe.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={loadSample}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/55 transition hover:border-white/25 hover:text-white"
                >
                  Load demo
                </button>
              </div>

              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.15em] text-white/40">
                Repository
              </label>
              <input
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
                className="mb-5 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 font-mono text-sm text-white outline-none transition placeholder:text-white/20 focus:border-emerald-300/45 focus:ring-4 focus:ring-emerald-300/5"
                placeholder="https://github.com/org/repo"
                required
              />

              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.15em] text-white/40">
                Incident
              </label>
              <textarea
                value={incident}
                onChange={(event) => setIncident(event.target.value)}
                className="min-h-64 w-full resize-y rounded-2xl border border-white/10 bg-black/20 px-4 py-4 font-mono text-[13px] leading-6 text-white outline-none transition placeholder:text-white/20 focus:border-emerald-300/45 focus:ring-4 focus:ring-emerald-300/5"
                placeholder="Paste the stack trace, alert, or failure description…"
                required
              />

              {error ? (
                <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/5 px-4 py-3 text-sm text-rose-100">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-5 py-3.5 text-sm font-bold text-[#062016] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span
                  className={loading ? "pulse-dot h-2 w-2 rounded-full bg-[#062016]" : "h-2 w-2 rounded-full bg-[#062016]"}
                />
                {loading ? "Investigating…" : "Run PatchScout"}
              </button>

              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                {[
                  ["Ground", "Tavily"],
                  ["Reason", "Nemotron"],
                  ["Verify", "Sandbox"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-2 py-3"
                  >
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/25">
                      {label}
                    </div>
                    <div className="mt-1 text-xs font-medium text-white/65">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </form>

            <section className="panel min-h-[720px] rounded-[28px] p-5 md:p-7">
              {!result && !loading ? (
                <div className="flex min-h-[665px] flex-col justify-between">
                  <div>
                    <div className="mb-8 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-white/30">
                      <span className="h-2 w-2 rounded-full bg-emerald-300/60" />
                      agent trace
                    </div>
                    <div className="space-y-3">
                      {[
                        ["01", "Normalize the incident", "Extract the failure boundary, runtime, and evidence."],
                        ["02", "Research upstream", "Search official docs, release notes, and issue history."],
                        ["03", "Isolate root cause", "Use Nemotron to rank evidence-backed hypotheses."],
                        ["04", "Produce minimal patch", "Change only what the evidence justifies."],
                        ["05", "Verify and package proof", "Run focused checks and preserve a rollback path."],
                      ].map(([number, title, detail]) => (
                        <div
                          key={number}
                          className="flex gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.018] p-4"
                        >
                          <div className="font-mono text-xs text-emerald-300/55">
                            {number}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white/70">
                              {title}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-white/30">
                              {detail}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-8 rounded-2xl border border-dashed border-white/10 p-5 text-sm leading-6 text-white/35">
                    The output is not “an answer.” It is a reviewable repair
                    artifact: sources, causal chain, diff, tests, confidence, and
                    rollback.
                  </div>
                </div>
              ) : null}

              {loading ? (
                <div className="flex min-h-[665px] items-center justify-center">
                  <div className="w-full max-w-xl">
                    <div className="mb-8 text-center">
                      <div className="mx-auto mb-5 h-12 w-12 rounded-full border border-emerald-300/30 bg-emerald-300/10 p-3">
                        <div className="pulse-dot h-full w-full rounded-full bg-emerald-300" />
                      </div>
                      <div className="text-lg font-semibold">Following the evidence</div>
                      <div className="mt-2 text-sm text-white/35">
                        Researching upstream context before proposing code.
                      </div>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-white/5">
                      <div className="scan-line h-full w-2/5 rounded-full bg-emerald-300" />
                    </div>
                  </div>
                </div>
              ) : null}

              {result ? (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.15em] ${
                            result.mode === "live"
                              ? "bg-emerald-300 text-[#062016]"
                              : "border border-amber-200/25 bg-amber-200/10 text-amber-100"
                          }`}
                        >
                          {result.mode}
                        </span>
                        <span className="text-xs text-white/30">
                          {completedSteps}/{result.steps.length} stages complete
                        </span>
                      </div>
                      <h2 className="text-2xl font-semibold tracking-tight text-white">
                        Evidence pack
                      </h2>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-right">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-white/30">
                        Confidence
                      </div>
                      <div className="mt-1 font-mono text-2xl font-bold text-emerald-200">
                        {Math.round(result.confidence * 100)}%
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.045] p-5">
                    <div className="eyebrow">Executive summary</div>
                    <p className="mt-2 text-sm leading-6 text-white/75">
                      {result.summary}
                    </p>
                  </div>

                  <div>
                    <div className="eyebrow mb-3">Agent trace</div>
                    <div className="grid gap-2 md:grid-cols-5">
                      {result.steps.map((step) => (
                        <div
                          key={step.stage}
                          className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3"
                        >
                          <div className="mb-3 flex items-center justify-between">
                            <span className="font-mono text-[10px] text-white/25">
                              {stageLabels[step.stage]}
                            </span>
                            <span
                              className={`h-2 w-2 rounded-full ${
                                step.status === "complete"
                                  ? "bg-emerald-300"
                                  : step.status === "failed"
                                    ? "bg-rose-300"
                                    : "bg-amber-200"
                              }`}
                            />
                          </div>
                          <div className="text-xs font-semibold text-white/70">
                            {step.title}
                          </div>
                          <div className="mt-1 line-clamp-3 text-[11px] leading-4 text-white/30">
                            {step.detail}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-white/[0.07] bg-black/15 p-5">
                      <div className="eyebrow">Root cause</div>
                      <p className="mt-3 text-sm leading-6 text-white/70">
                        {result.rootCause}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/[0.07] bg-black/15 p-5">
                      <div className="eyebrow">Repair plan</div>
                      <ol className="mt-3 space-y-2">
                        {result.patchPlan.map((item, index) => (
                          <li
                            key={`${index}-${item}`}
                            className="flex gap-3 text-sm leading-5 text-white/65"
                          >
                            <span className="font-mono text-[10px] text-emerald-300/60">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            {item}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>

                  <div>
                    <div className="eyebrow mb-3">Proposed diff</div>
                    <pre className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-[#030805] p-5 font-mono text-[12px] leading-6 text-emerald-50/75">
                      <code>{result.diff || "No textual diff was returned."}</code>
                    </pre>
                  </div>

                  <div>
                    <div className="eyebrow mb-3">Verification</div>
                    <div className="space-y-2">
                      {result.tests.map((test) => (
                        <div
                          key={test.command}
                          className="grid gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 md:grid-cols-[auto_1fr]"
                        >
                          <span
                            className={`h-fit rounded-full px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] ${
                              test.status === "passed"
                                ? "bg-emerald-300/15 text-emerald-200"
                                : test.status === "failed"
                                  ? "bg-rose-300/15 text-rose-200"
                                  : "bg-amber-200/10 text-amber-100"
                            }`}
                          >
                            {test.status}
                          </span>
                          <div>
                            <code className="text-xs text-white/75">{test.command}</code>
                            <div className="mt-1 text-xs leading-5 text-white/30">
                              {test.output}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {result.sandbox ? (
                    <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.035] p-5">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="eyebrow">Token Factory Sandbox</div>
                        <span
                          className={`rounded-full px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] ${
                            result.sandbox.status === "executed"
                              ? "bg-emerald-300/15 text-emerald-200"
                              : result.sandbox.status === "failed"
                                ? "bg-rose-300/15 text-rose-200"
                                : "bg-amber-200/10 text-amber-100"
                          }`}
                        >
                          {result.sandbox.status}
                        </span>
                      </div>
                      <p className="text-sm leading-6 text-white/60">
                        {result.sandbox.message}
                      </p>
                      {result.sandbox.project ? (
                        <div className="mt-3 font-mono text-[11px] text-white/30">
                          project: {result.sandbox.project}
                        </div>
                      ) : null}
                      {result.sandbox.operationId ? (
                        <div className="mt-1 font-mono text-[11px] text-white/30">
                          operation: {result.sandbox.operationId}
                        </div>
                      ) : null}
                      {result.sandbox.baselineExit !== undefined ||
                      result.sandbox.afterExit !== undefined ? (
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                            <div className="text-[10px] uppercase tracking-[0.14em] text-white/30">
                              baseline exit
                            </div>
                            <div className="mt-1 font-mono text-lg text-rose-200">
                              {String(result.sandbox.baselineExit)}
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                            <div className="text-[10px] uppercase tracking-[0.14em] text-white/30">
                              after exit
                            </div>
                            <div className="mt-1 font-mono text-lg text-emerald-200">
                              {String(result.sandbox.afterExit)}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {result.sandbox.baselineOutput || result.sandbox.afterOutput ? (
                        <pre className="mt-4 max-h-72 overflow-auto rounded-xl border border-white/[0.06] bg-[#020604] p-4 font-mono text-[11px] leading-5 text-white/45">
                          {[
                            result.sandbox.baselineOutput
                              ? "BASELINE\n" + result.sandbox.baselineOutput
                              : "",
                            result.sandbox.afterOutput
                              ? "AFTER\n" + result.sandbox.afterOutput
                              : "",
                          ]
                            .filter(Boolean)
                            .join("\n\n")}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}


                  {result.sources.length ? (
                    <div>
                      <div className="eyebrow mb-3">Research evidence</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {result.sources.map((source) => (
                          <a
                            key={source.url}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="group rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 transition hover:border-emerald-300/25 hover:bg-emerald-300/[0.035]"
                          >
                            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-300/55">
                              {hostname(source.url)}
                            </div>
                            <div className="mt-2 text-sm font-medium text-white/70 group-hover:text-white">
                              {source.title}
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/30">
                              {source.snippet}
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <div className="eyebrow">Rollback</div>
                    <div className="mt-2 text-sm leading-6 text-white/55">
                      {result.rollback}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-4 text-[11px] text-white/25">
                    <span>Model: {result.model}</span>
                    <span>
                      Evidence before inference · verification before merge
                    </span>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
