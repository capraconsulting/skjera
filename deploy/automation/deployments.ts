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
  await api(`${ROOT}/${deployment.id}/statuses`, {
    state,
    description,
    environment_url: `https://${deployment.environment}.skjera.capraconsulting.no`,
    log_url: `https://github.com/${REPOSITORY}/actions/runs/${required("GITHUB_RUN_ID")}`,
    auto_inactive: false,
  });
}
export async function create(pr: string, head: string): Promise<Deployment> {
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
