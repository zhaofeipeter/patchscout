export type AgentStage =
  | "intake"
  | "research"
  | "diagnose"
  | "patch"
  | "verify";

export type StepStatus = "complete" | "running" | "pending" | "failed";

export interface AgentRequest {
  repoUrl: string;
  incident: string;
}

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

export interface AgentStep {
  stage: AgentStage;
  title: string;
  detail: string;
  status: StepStatus;
  durationMs?: number;
}

export interface TestResult {
  command: string;
  status: "passed" | "failed" | "planned";
  output: string;
}

export interface AgentResult {
  mode: "live" | "demo";
  model: string;
  repoUrl: string;
  incident: string;
  summary: string;
  rootCause: string;
  patchPlan: string[];
  diff: string;
  tests: TestResult[];
  rollback: string;
  confidence: number;
  sources: ResearchSource[];
  steps: AgentStep[];
  rawModelOutput?: string;
  sandbox?: {
    status: "waiting-permission" | "ready" | "executed" | "failed";
    message: string;
    project?: string;
    operationId?: string;
    baselineExit?: number;
    afterExit?: number;
    baselineOutput?: string;
    afterOutput?: string;
    stderr?: string;
  };
}
