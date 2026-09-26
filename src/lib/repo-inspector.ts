import { outboundFetch } from "./outbound-fetch";

export interface RepositorySnapshot {
  defaultBranch: string;
  files: string[];
  dependencies: string[];
  context: string;
}

interface GitHubRepoMetadata {
  default_branch?: string;
}

interface GitTreeItem {
  path?: string;
  type?: string;
  size?: number;
}

interface GitTreeResponse {
  tree?: GitTreeItem[];
  truncated?: boolean;
}

async function fetchWithRetry(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  const delays = [350];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await outboundFetch(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(8_000),
      });
      if (
        ![429, 500, 502, 503, 504].includes(response.status) ||
        attempt === 1
      ) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === 1) break;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, delays[Math.min(attempt, delays.length - 1)]),
    );
  }

  throw lastError instanceof Error
    ? new Error("Repository fetch failed: " + lastError.message)
    : new Error("Repository fetch failed.");
}

function parseGitHubRepo(repoUrl: string): { owner: string; repo: string } {
  const url = new URL(repoUrl);
  if (url.hostname !== "github.com") {
    throw new Error("PatchScout currently requires a public GitHub repository.");
  }

  const [owner, repoRaw] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repoRaw) {
    throw new Error("Invalid GitHub repository URL.");
  }

  return {
    owner,
    repo: repoRaw.replace(/\.git$/, ""),
  };
}

function encodeRepoPath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function priority(path: string): number {
  const lower = path.toLowerCase();

  if (lower === "package.json") return 100;
  if (lower === "readme.md") return 95;
  if (lower.startsWith("test/") || lower.startsWith("tests/")) return 90;
  if (lower.startsWith("src/")) return 85;
  if (/\.(?:js|mjs|cjs|ts|tsx|jsx)$/.test(lower)) return 80;
  if (/\.(?:json|yaml|yml|toml)$/.test(lower)) return 65;
  return 0;
}

function isUseful(path: string, size?: number): boolean {
  const lower = path.toLowerCase();

  if (
    lower.includes("node_modules/") ||
    lower.includes("/dist/") ||
    lower.includes("/build/") ||
    lower.includes("/coverage/") ||
    lower.endsWith("package-lock.json") ||
    lower.endsWith("yarn.lock") ||
    lower.endsWith("pnpm-lock.yaml") ||
    lower.endsWith(".map")
  ) {
    return false;
  }

  if (typeof size === "number" && size > 80_000) return false;
  return priority(path) > 0;
}

export async function inspectRepository(
  repoUrl: string,
): Promise<RepositorySnapshot> {
  const { owner, repo } = parseGitHubRepo(repoUrl);
  const apiBase =
    "https://api.github.com/repos/" +
    encodeURIComponent(owner) +
    "/" +
    encodeURIComponent(repo);

  const commonHeaders = {
    Accept: "application/vnd.github+json",
    "User-Agent": "PatchScout/1.0",
  };

  const metadataResponse = await fetchWithRetry(apiBase, {
    headers: commonHeaders,
    cache: "no-store",
  });

  if (!metadataResponse.ok) {
    throw new Error(
      "Repository metadata failed (" + metadataResponse.status + ").",
    );
  }

  const metadata = (await metadataResponse.json()) as GitHubRepoMetadata;
  const defaultBranch = metadata.default_branch || "main";

  const treeResponse = await fetchWithRetry(
    apiBase +
      "/git/trees/" +
      encodeURIComponent(defaultBranch) +
      "?recursive=1",
    {
      headers: commonHeaders,
      cache: "no-store",
    },
  );

  if (!treeResponse.ok) {
    throw new Error(
      "Repository tree failed (" + treeResponse.status + ").",
    );
  }

  const tree = (await treeResponse.json()) as GitTreeResponse;
  const candidates = (tree.tree || [])
    .filter(
      (item): item is GitTreeItem & { path: string } =>
        item.type === "blob" &&
        typeof item.path === "string" &&
        isUseful(item.path, item.size),
    )
    .sort((a, b) => {
      const score = priority(b.path) - priority(a.path);
      return score !== 0 ? score : a.path.localeCompare(b.path);
    })
    .slice(0, 10);

  if (!candidates.length) {
    throw new Error("No inspectable source files were found in the repository.");
  }

  const chunks: string[] = [];
  const files: string[] = [];
  const dependencies = new Set<string>();

  const fetched = await Promise.all(
    candidates.map(async (item) => {
      const rawUrl =
        "https://raw.githubusercontent.com/" +
        encodeURIComponent(owner) +
        "/" +
        encodeURIComponent(repo) +
        "/" +
        encodeURIComponent(defaultBranch) +
        "/" +
        encodeRepoPath(item.path);

      try {
        const response = await fetchWithRetry(rawUrl, { cache: "no-store" });
        if (!response.ok) return null;
        return { item, text: await response.text() };
      } catch {
        return null;
      }
    }),
  );

  let budget = 28_000;
  for (const entry of fetched) {
    if (!entry || budget <= 0) continue;
    const { item, text } = entry;

    if (item.path.toLowerCase() === "package.json") {
      try {
        const pkg = JSON.parse(text) as Record<string, unknown>;
        for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
          const group = pkg[field];
          if (group && typeof group === "object") {
            for (const name of Object.keys(group as Record<string, unknown>)) {
              dependencies.add(name);
            }
          }
        }
      } catch {
        // Keep inspection usable even when package metadata is malformed.
      }
    }

    const excerpt = text.slice(0, Math.min(4_000, budget));
    if (!excerpt.trim()) continue;
    files.push(item.path);
    chunks.push("--- " + item.path + " ---\n" + excerpt);
    budget -= excerpt.length;
  }

  if (!chunks.length) {
    throw new Error("Repository files could not be read.");
  }

  return {
    defaultBranch,
    files,
    dependencies: [...dependencies],
    context: chunks.join("\n\n"),
  };
}
