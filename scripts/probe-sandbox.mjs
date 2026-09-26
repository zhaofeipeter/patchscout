import { ContreeClient } from "contree-client";

const key = process.env.NEBIUS_API_KEY;
const project = process.env.NEBIUS_PROJECT_ID || process.env.NEBIUS_SANDBOX_PROJECT || "default-project";
const baseUrl =
  process.env.NEBIUS_SANDBOX_BASE_URL ||
  "https://api.tokenfactory.nebius.com/sandboxes";

if (!key) {
  console.error("SANDBOX_PROBE_CONFIG_MISSING");
  process.exit(2);
}

const client = new ContreeClient(key, {
  baseUrl,
  project,
  timeout: 30_000,
});

try {
  const spawned = await client.spawnInstance(
    "printf PATCHSCOUT_SANDBOX_OK",
    "tag:ubuntu:latest",
    {
      shell: true,
      disposable: true,
      timeout: 90,
      truncate_output_at: 100_000,
    },
  );

  if (!spawned.uuid) throw new Error("No operation id returned.");

  const operation = await client.waitOperation(spawned.uuid, {
    timeout: 120,
  });
  const result = operation.metadata?.result;
  const stdout = result?.stdout?.asText?.() || "";
  const stderr = result?.stderr?.asText?.() || "";
  const exitCode =
    result?.state && "exit_code" in result.state
      ? result.state.exit_code
      : null;

  console.log("SANDBOX_OPERATION_ID=" + spawned.uuid);
  console.log("SANDBOX_STATUS=" + (operation.status || "unknown"));
  console.log("SANDBOX_EXIT=" + String(exitCode));
  console.log("SANDBOX_STDOUT=" + stdout.trim());
  if (stderr.trim()) console.log("SANDBOX_STDERR=" + stderr.trim().slice(0, 500));
} catch (error) {
  console.error("SANDBOX_PROBE_FAILED=" + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 3;
} finally {
  await client.close();
}
