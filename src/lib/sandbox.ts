import {
  ContreeClient,
  ImageImportRegistry,
  InstanceNetworking,
  type OperationInstanceMetadata,
} from "contree-client";

const DEFAULT_SANDBOX_URL =
  "https://api.tokenfactory.nebius.com/sandboxes";
const DEFAULT_NODE_IMAGE = "patchscout-node22-bookworm";
const NODE_REGISTRY_IMAGE = "docker://docker.io/library/node:22-bookworm";

export interface SandboxRun {
  operationId: string;
  status: string;
  sourceImage: string;
  resultImage: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error: string | null;
}

export interface SandboxCapability {
  available: boolean;
  project: string;
  message: string;
}

export interface PatchEdit {
  path: string;
  search: string;
  replace: string;
}

export interface PreparedSandboxRepository {
  image: string;
  files: string[];
  dependencies: string[];
  context: string;
  setupOperationId: string;
}

export interface MigrationExecution {
  available: boolean;
  message: string;
  operationId?: string;
  baselineExit?: number;
  afterExit?: number;
  baselineOutput?: string;
  afterOutput?: string;
  stderr?: string;
  rollbackImage?: string;
  patchedImage?: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is not configured.");
  return value;
}

export function sandboxConfigured(): boolean {
  return Boolean(process.env.NEBIUS_API_KEY?.trim());
}

function makeClient(): ContreeClient {
  return new ContreeClient(requiredEnv("NEBIUS_API_KEY"), {
    baseUrl:
      process.env.NEBIUS_SANDBOX_BASE_URL?.trim() ||
      DEFAULT_SANDBOX_URL,
    project:
      process.env.NEBIUS_PROJECT_ID?.trim() ||
      process.env.NEBIUS_SANDBOX_PROJECT?.trim() ||
      "default-project",
    timeout: 30_000,
  });
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

async function ensureNodeImage(): Promise<string> {
  const client = makeClient();
  const tag =
    process.env.NEBIUS_SANDBOX_NODE_TAG?.trim() ||
    DEFAULT_NODE_IMAGE;

  try {
    try {
      return await client.inspectFindImageByTag(tag);
    } catch {
      const operationId = await client.importImage(
        new ImageImportRegistry({ url: NODE_REGISTRY_IMAGE }),
        { tag, timeout: 600 },
      );
      const operation = await client.waitOperation(operationId, {
        timeout: 630,
      });
      const image =
        operation.result_image_uuid ||
        operation.result?.image ||
        null;
      if (!image) {
        throw new Error(
          operation.error ||
            "Node sandbox image import completed without an image.",
        );
      }
      return image;
    }
  } finally {
    await client.close();
  }
}

export async function runSandboxCommand(
  image: string,
  command: string,
  options?: {
    cwd?: string;
    disposable?: boolean;
    timeoutSeconds?: number;
    env?: Record<string, string>;
  },
): Promise<SandboxRun> {
  const client = makeClient();

  try {
    const spawned = await client.spawnInstance(command, image, {
      shell: true,
      disposable: options?.disposable ?? false,
      cwd: options?.cwd,
      env: options?.env,
      networking: new InstanceNetworking({ enabled: true }),
      timeout: options?.timeoutSeconds ?? 300,
      truncate_output_at: 2_000_000,
    });

    if (!spawned.uuid) {
      throw new Error("Sandbox did not return an operation id.");
    }

    const operation = await client.waitOperation(spawned.uuid, {
      timeout: (options?.timeoutSeconds ?? 300) + 30,
    });

    const metadata = operation.metadata as
      | OperationInstanceMetadata
      | undefined;
    const result = metadata?.result;
    const exitCode =
      result?.state && "exit_code" in result.state
        ? (result.state.exit_code ?? null)
        : null;

    return {
      operationId: spawned.uuid,
      status: operation.status || "unknown",
      sourceImage: image,
      resultImage:
        operation.result_image_uuid ||
        operation.result?.image ||
        null,
      stdout: result?.stdout?.asText() || "",
      stderr: result?.stderr?.asText() || "",
      exitCode,
      error: operation.error || null,
    };
  } finally {
    await client.close();
  }
}

export async function prepareRepositoryInSandbox(
  repoUrl: string,
): Promise<PreparedSandboxRepository> {
  const nodeImage = await ensureNodeImage();
  const setupCommand = [
    "set -e",
    "rm -rf /workspace",
    "git clone --depth 1 " + shellQuote(repoUrl) + " /workspace",
    "cd /workspace",
    "if [ -f package-lock.json ]; then npm ci; else npm install; fi",
  ].join(" && ");

  const setup = await runSandboxCommand(nodeImage, setupCommand, {
    disposable: false,
    timeoutSeconds: 300,
  });

  if (setup.exitCode !== 0 || !setup.resultImage) {
    throw new Error(
      "Sandbox repository preparation failed: " +
        (setup.stderr || setup.error || setup.stdout || "unknown error"),
    );
  }

  const inspectorScript = [
    "const fs=require('fs'),path=require('path');",
    "const NL=String.fromCharCode(10);",
    "const out=[];",
    "const skipped=new Set(['node_modules','.git','dist','build','coverage','.next','out']);",
    "function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(skipped.has(e.name))continue;const joined=path.posix.join(dir,e.name);const p=joined.startsWith('./')?joined.slice(2):joined;if(e.isDirectory())walk(p);else if(e.isFile())out.push(p);}}",
    "walk('.');",
    "const codeExt=['.js','.mjs','.cjs','.ts','.tsx','.jsx'];",
    "const configExt=['.json','.yaml','.yml','.toml'];",
    "function score(p){const x=p.toLowerCase();if(x==='package.json')return 100;if(x==='readme.md')return 95;if(x.startsWith('test/')||x.startsWith('tests/'))return 90;if(x.startsWith('src/'))return 85;if(codeExt.some(ext=>x.endsWith(ext)))return 80;if(configExt.some(ext=>x.endsWith(ext)))return 65;return 0;}",
    "function ignored(p){const x=p.toLowerCase();return x.endsWith('package-lock.json')||x.endsWith('yarn.lock')||x.endsWith('pnpm-lock.yaml')||x.endsWith('.map');}",
    "const candidates=out.filter(p=>!ignored(p)).filter(p=>{try{return fs.statSync(p).size<=80000&&score(p)>0}catch{return false}}).sort((a,b)=>score(b)-score(a)||a.localeCompare(b)).slice(0,10);",
    "let budget=28000;const chunks=[];const files=[];const deps=new Set();",
    "for(const p of candidates){if(budget<=0)break;let text='';try{text=fs.readFileSync(p,'utf8')}catch{continue}if(p.toLowerCase()==='package.json'){try{const pkg=JSON.parse(text);for(const f of ['dependencies','devDependencies','peerDependencies'])for(const n of Object.keys(pkg[f]||{}))deps.add(n)}catch{}}const ex=text.slice(0,Math.min(4000,budget));if(!ex.trim())continue;files.push(p);chunks.push('--- '+p+' ---'+NL+ex);budget-=ex.length;}",
    "const payload={files,dependencies:[...deps],context:chunks.join(NL+NL)};",
    "console.log('PATCHSCOUT_SNAPSHOT:'+Buffer.from(JSON.stringify(payload),'utf8').toString('base64'));",
  ].join("");
  const inspectorBase64 = Buffer.from(inspectorScript, "utf8").toString("base64");
  const inspectCommand =
    "printf %s " +
    shellQuote(inspectorBase64) +
    " | base64 -d > /tmp/patchscout-inspect.cjs && node /tmp/patchscout-inspect.cjs";

  const inspected = await runSandboxCommand(
    setup.resultImage,
    inspectCommand,
    {
      cwd: "/workspace",
      disposable: true,
      timeoutSeconds: 60,
    },
  );

  if (inspected.exitCode !== 0) {
    throw new Error(
      "Sandbox repository inspection failed: " +
        (inspected.stderr || inspected.error || inspected.stdout || "unknown error"),
    );
  }

  const marker = "PATCHSCOUT_SNAPSHOT:";
  const line = inspected.stdout
    .split(/\r?\n/)
    .find((value) => value.startsWith(marker));
  if (!line) {
    throw new Error("Sandbox inspection did not return a repository snapshot.");
  }

  const decoded = Buffer.from(line.slice(marker.length), "base64").toString("utf8");
  const snapshot = JSON.parse(decoded) as {
    files?: unknown;
    dependencies?: unknown;
    context?: unknown;
  };

  const files = Array.isArray(snapshot.files)
    ? snapshot.files.filter((value): value is string => typeof value === "string")
    : [];
  const dependencies = Array.isArray(snapshot.dependencies)
    ? snapshot.dependencies.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const context =
    typeof snapshot.context === "string" ? snapshot.context : "";

  if (!files.length || !context.trim()) {
    throw new Error("Sandbox repository snapshot was empty.");
  }

  return {
    image: setup.resultImage,
    files,
    dependencies,
    context,
    setupOperationId: setup.operationId,
  };
}

export async function probeSandboxAccess(): Promise<{
  ok: boolean;
  message: string;
  operationId?: string;
}> {
  if (!sandboxConfigured()) {
    return {
      ok: false,
      message: "Sandbox credentials are not configured.",
    };
  }

  try {
    const run = await runSandboxCommand(
      "tag:ubuntu:latest",
      "printf PATCHSCOUT_SANDBOX_OK",
      { disposable: true, timeoutSeconds: 90 },
    );
    const ok =
      run.exitCode === 0 &&
      run.stdout.includes("PATCHSCOUT_SANDBOX_OK");

    return {
      ok,
      message: ok
        ? "Token Factory Sandboxes spawn access is active."
        : run.error ||
          run.stderr ||
          "Sandbox probe did not complete successfully.",
      operationId: run.operationId,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Token Factory Sandboxes spawn probe failed.",
    };
  }
}

export async function probeSandbox(): Promise<SandboxCapability> {
  const project =
    process.env.NEBIUS_PROJECT_ID?.trim() ||
    process.env.NEBIUS_SANDBOX_PROJECT?.trim() ||
    "default-project";
  const probe = await probeSandboxAccess();
  return {
    available: probe.ok,
    project,
    message: probe.message,
  };
}

async function applyStructuredEditsAndTest(input: {
  baseImage: string;
  edits: PatchEdit[];
  testCommand: string;
}): Promise<{ patched: SandboxRun; after: SandboxRun }> {
  if (!input.edits.length) {
    throw new Error("No structured edits were provided.");
  }

  const editsBase64 = Buffer.from(
    JSON.stringify(input.edits),
    "utf8",
  ).toString("base64");

  const patchScript = [
    "const fs=require('fs');",
    "const edits=JSON.parse(Buffer.from(process.env.PATCHSCOUT_EDITS_B64,'base64').toString('utf8'));",
    "for(const edit of edits){",
    " if(!edit.path||!edit.search||typeof edit.replace!=='string') throw new Error('Invalid structured edit');",
    " if(edit.path.includes('..')||edit.path.startsWith('/')) throw new Error('Unsafe edit path: '+edit.path);",
    " const file=edit.path;",
    " if(!fs.existsSync(file)) throw new Error('Edit target not found: '+file);",
    " const before=fs.readFileSync(file,'utf8');",
    " const first=before.indexOf(edit.search);",
    " if(first<0) throw new Error('Search text not found in '+file);",
    " if(before.indexOf(edit.search,first+edit.search.length)>=0) throw new Error('Search text is not unique in '+file);",
    " const after=before.slice(0,first)+edit.replace+before.slice(first+edit.search.length);",
    " fs.writeFileSync(file,after);",
    "}",
  ].join("");

  const patchCommand =
    "node -e " + shellQuote(patchScript) +
    " && git diff --check && git diff --no-ext-diff";

  const patched = await runSandboxCommand(input.baseImage, patchCommand, {
    cwd: "/workspace",
    disposable: false,
    timeoutSeconds: 120,
    env: { PATCHSCOUT_EDITS_B64: editsBase64 },
  });

  if (patched.exitCode !== 0 || !patched.resultImage) {
    throw new Error(
      "Sandbox patch application failed: " +
        (patched.stderr || patched.error || patched.stdout || "unknown error"),
    );
  }

  const after = await runSandboxCommand(
    patched.resultImage,
    input.testCommand,
    {
      cwd: "/workspace",
      disposable: true,
      timeoutSeconds: 180,
    },
  );

  return { patched, after };
}

export async function executePreparedMigrationInSandbox(input: {
  baseImage: string;
  edits: PatchEdit[];
  testCommand: string;
}): Promise<MigrationExecution> {
  const baseline = await runSandboxCommand(
    input.baseImage,
    input.testCommand,
    {
      cwd: "/workspace",
      disposable: true,
      timeoutSeconds: 180,
    },
  );

  const { patched, after } = await applyStructuredEditsAndTest(input);
  const baselineExit = baseline.exitCode ?? undefined;
  const afterExit = after.exitCode ?? undefined;
  const verified =
    baselineExit !== undefined &&
    baselineExit !== 0 &&
    afterExit === 0;

  return {
    available: true,
    message: verified
      ? "Sandbox reproduced the baseline failure, applied the candidate on a branch checkpoint, and the same verification command passed."
      : "Sandbox execution completed, but the required fail-before/pass-after transition was not observed.",
    operationId: after.operationId,
    baselineExit,
    afterExit,
    baselineOutput: [baseline.stdout, baseline.stderr].filter(Boolean).join("\n"),
    afterOutput: [after.stdout, after.stderr].filter(Boolean).join("\n"),
    stderr: [patched.stderr, after.stderr].filter(Boolean).join("\n"),
    rollbackImage: input.baseImage,
    patchedImage: patched.resultImage || undefined,
  };
}

export async function executePatchOnSandboxImage(input: {
  baseImage: string;
  edits: PatchEdit[];
  testCommand: string;
}): Promise<MigrationExecution> {
  const { patched, after } = await applyStructuredEditsAndTest(input);
  return {
    available: true,
    message:
      after.exitCode === 0
        ? "Repaired sandbox candidate passed the verification command."
        : "Repaired sandbox candidate still failed verification.",
    operationId: after.operationId,
    afterExit: after.exitCode ?? undefined,
    afterOutput: [after.stdout, after.stderr].filter(Boolean).join("\n"),
    stderr: [patched.stderr, after.stderr].filter(Boolean).join("\n"),
    rollbackImage: input.baseImage,
    patchedImage: patched.resultImage || undefined,
  };
}

export async function executeMigrationInSandbox(input: {
  repoUrl: string;
  edits: PatchEdit[];
  testCommand: string;
}): Promise<MigrationExecution> {
  const nodeImage = await ensureNodeImage();

  const setupCommand = [
    "set -e",
    "rm -rf /workspace",
    "git clone --depth 1 " + shellQuote(input.repoUrl) + " /workspace",
    "cd /workspace",
    "if [ -f package-lock.json ]; then npm ci; else npm install; fi",
  ].join(" && ");

  const setup = await runSandboxCommand(nodeImage, setupCommand, {
    disposable: false,
    timeoutSeconds: 300,
  });

  if (setup.exitCode !== 0 || !setup.resultImage) {
    throw new Error(
      "Sandbox repository setup failed: " +
        (setup.stderr || setup.error || setup.stdout || "unknown error"),
    );
  }

  const baseline = await runSandboxCommand(
    setup.resultImage,
    input.testCommand,
    {
      cwd: "/workspace",
      disposable: true,
      timeoutSeconds: 180,
    },
  );

  const { patched, after } = await applyStructuredEditsAndTest({
    baseImage: setup.resultImage,
    edits: input.edits,
    testCommand: input.testCommand,
  });

  const baselineExit = baseline.exitCode ?? undefined;
  const afterExit = after.exitCode ?? undefined;
  const verified =
    baselineExit !== undefined &&
    baselineExit !== 0 &&
    afterExit === 0;

  return {
    available: true,
    message: verified
      ? "Sandbox reproduced the baseline failure, applied the candidate patch on a branch checkpoint, and the same verification command passed."
      : "Sandbox execution completed, but the required fail-before/pass-after transition was not observed.",
    operationId: after.operationId,
    baselineExit,
    afterExit,
    baselineOutput: [baseline.stdout, baseline.stderr]
      .filter(Boolean)
      .join("\n"),
    afterOutput: [after.stdout, after.stderr]
      .filter(Boolean)
      .join("\n"),
    stderr: [setup.stderr, patched.stderr, after.stderr]
      .filter(Boolean)
      .join("\n"),
    rollbackImage: setup.resultImage,
    patchedImage: patched.resultImage || undefined,
  };
}
