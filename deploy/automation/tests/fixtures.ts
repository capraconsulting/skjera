import type { Build, Metadata, Pull } from "../github.ts";
export function fixture() {
  const image = `440027025698.dkr.ecr.eu-north-1.amazonaws.com/skjera-dev@sha256:${"a".repeat(64)}`;
  const metadata: Metadata = {
    prNumber: "123",
    image,
    headSha: "b".repeat(40),
    runId: "100",
    runAttempt: "1",
  };
  const build: Build = {
    id: 100,
    run_attempt: 1,
    event: "pull_request",
    conclusion: "success",
    head_branch: "feature",
    head_sha: metadata.headSha,
    head_repository: { full_name: "capraconsulting/skjera" },
    actor: { login: "TheKnarf" },
  };
  const pr: Pull = {
    number: 123,
    state: "open",
    user: { login: "TheKnarf" },
    head: {
      ref: "feature",
      sha: metadata.headSha,
      repo: { full_name: "capraconsulting/skjera" },
    },
  };
  return { metadata, build, pr };
}
