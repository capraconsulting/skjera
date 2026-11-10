/** Remove only images tagged for closed PRs; keep main and open PRs. */
import { api, type Pull, REPOSITORY } from "./github.ts";
import { run } from "./process.ts";

export async function closedTags(
  images: { imageTags?: string[] }[],
  lookup: (pr: string) => Promise<Pick<Pull, "state">>,
) {
  const states = new Map<string, string>();
  const result: { imageTag: string }[] = [];
  for (const image of images)
    for (const tag of image.imageTags ?? []) {
      const pr = /^pr-([1-9][0-9]{0,8})-sha-[a-f0-9]{40}-[0-9]+-[0-9]+$/.exec(
        tag,
      )?.[1];
      if (!pr) continue;
      if (!states.has(pr)) states.set(pr, (await lookup(pr)).state);
      if (states.get(pr) === "closed") result.push({ imageTag: tag });
    }
  return result;
}
export function aws<T>(...args: string[]): T {
  return JSON.parse(
    run("aws", [
      "ecr",
      ...args,
      "--repository-name",
      "skjera-dev",
      "--region",
      "eu-north-1",
      "--output",
      "json",
    ]).toString(),
  );
}
export async function cleanup(apply = false): Promise<void> {
  const tags = await closedTags(
    aws<{ imageDetails: { imageTags?: string[] }[] }>("describe-images")
      .imageDetails,
    (pr) => api<Pull>(`repos/${REPOSITORY}/pulls/${pr}`),
  );
  console.log(`Closed-preview image tags eligible for cleanup: ${tags.length}`);
  if (!apply) {
    console.log("Dry run; no ECR changes.");
    return;
  }
  for (let start = 0; start < tags.length; start += 100) {
    const result = aws<{ failures?: { failureCode: string }[] }>(
      "batch-delete-image",
      "--image-ids",
      JSON.stringify(tags.slice(start, start + 100)),
    );
    if (result.failures?.some((f) => f.failureCode !== "ImageNotFound"))
      throw new Error("ECR rejected image deletions");
  }
}
if (import.meta.main) await cleanup(process.argv.includes("--apply"));
