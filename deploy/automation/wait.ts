/** Wait for the desired image and database over public HTTPS. */
import { appendFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { create, status } from "./deployments.ts";
import { api, eligible, type Pull, REPOSITORY } from "./github.ts";
import { required } from "./process.ts";

export async function waitReady(
  pr: string,
  image: string,
  head: string,
  timeout = 1_500_000,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  const url = `https://pr-${pr}.skjera.capraconsulting.no`;
  while (Date.now() < deadline) {
    const current = await api<Pull>(`repos/${REPOSITORY}/pulls/${pr}`);
    if (!eligible(current) || current.head.sha !== head) {
      console.log("Preview closed or superseded; stopping.");
      return false;
    }
    try {
      const response = await fetch(`${url}/health/ready`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (
        response.status === 200 &&
        response.headers.get("X-Skjera-Image") === image &&
        (await response.text()) === "ok"
      ) {
        console.log(`Desired image is ready: ${url}`);
        if (process.env.GITHUB_STEP_SUMMARY)
          appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `Preview ready: [${url}](${url})\n\nLogin: \`preview@example.com\` (password in PREVIEW_DEX_PASSWORD).\n`,
          );
        return true;
      }
      await response.body?.cancel();
    } catch {
      /* Argo CD and Auto Mode can take time to provision dependencies. */
    }
    await setTimeout(10_000);
  }
  throw new Error(
    `Desired image did not become ready at ${url}; inspect Argo CD`,
  );
}
export async function wait(
  pr: string,
  image: string,
  head: string,
  timeout?: number,
): Promise<void> {
  const current = await api<Pull>(`repos/${REPOSITORY}/pulls/${pr}`);
  if (!eligible(current) || current.head.sha !== head) return;
  const deployment = await create(pr, head);
  try {
    const ready = await waitReady(pr, image, head, timeout);
    await status(
      deployment,
      ready ? "success" : "inactive",
      ready ? "Preview is ready" : "Preview closed or superseded",
    );
  } catch (error) {
    await status(
      deployment,
      "failure",
      "Preview readiness failed; inspect the workflow and Argo CD",
    );
    throw error;
  }
}
if (import.meta.main)
  await wait(required("PR_NUMBER"), required("IMAGE"), required("HEAD_SHA"));
