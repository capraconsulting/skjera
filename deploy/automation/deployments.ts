/** Publish preview links using GitHub deployments, without PR comments. */
import { api, eligible, type Pull, pages, REPOSITORY } from "./github.ts";
import { required } from "./process.ts";

const TASK = "skjera-preview";
const ROOT = `repos/${REPOSITORY}/deployments`;
export interface Deployment {
  id: number;
  environment: string;
  sha: string;
}
export async function status(
  deployment: Deployment,
  state: string,
  description: string,
): Promise<void> {
  const url = `https://${deployment.environment}.skjera.capraconsulting.no`;
  const latest = await api<{ state: string; environment_url?: string }[]>(
    `${ROOT}/${deployment.id}/statuses?per_page=1`,
  );
  if (latest[0]?.state === state && latest[0].environment_url === url) return;
  await api(`${ROOT}/${deployment.id}/statuses`, {
    state,
    description,
    environment_url: url,
    log_url: `https://github.com/${REPOSITORY}/actions/runs/${required("GITHUB_RUN_ID")}`,
    auto_inactive: false,
  });
}
export async function create(pr: string, head: string): Promise<Deployment> {
  // Readiness jobs are serialized per PR. Reuse the record on hourly recovery
  // runs and retries, including retries after a failed readiness check.
  const existing = await api<Deployment[]>(
    `${ROOT}?task=${TASK}&environment=pr-${pr}&sha=${head}&per_page=1`,
  );
  if (existing[0]) return existing[0];
  const deployment = await api<Deployment>(ROOT, {
    ref: head,
    task: TASK,
    environment: `pr-${pr}`,
    auto_merge: false,
    required_contexts: [],
    transient_environment: true,
    production_environment: false,
    description: `Argo CD preview for PR #${pr}`,
  });
  await status(
    deployment,
    "in_progress",
    "Waiting for the published image and database over HTTPS",
  );
  return deployment;
}
export async function retireClosed(): Promise<void> {
  const pulls = new Map<string, Pull>();
  for await (const deployment of pages<Deployment>(`${ROOT}?task=${TASK}`)) {
    const number = /^pr-([1-9][0-9]{0,8})$/.exec(deployment.environment)?.[1];
    if (!number) continue;
    let pr = pulls.get(number);
    if (!pr) {
      pr = await api<Pull>(`repos/${REPOSITORY}/pulls/${number}`);
      pulls.set(number, pr);
    }
    if (eligible(pr) && pr.head.sha === deployment.sha) continue;
    const latest = await api<{ state: string }[]>(
      `${ROOT}/${deployment.id}/statuses?per_page=1`,
    );
    if (latest[0]?.state !== "inactive")
      await status(
        deployment,
        "inactive",
        "Preview closed or replaced by a newer PR revision",
      );
  }
}
if (import.meta.main) await retireClosed();
