import { branchFor } from "./git.ts";

export function buildPrompt({
  repo,
  issue,
  trigger,
  firstInSession,
}: {
  repo: string;
  issue: { number: number; title: string; body: string | null };
  trigger: { kind: "issue" | "comment"; author: string; body: string };
  firstInSession: boolean;
}) {
  const message = `${trigger.kind === "issue" ? "New issue" : "New comment"} from @${trigger.author}:\n\n${trigger.body}`;
  if (!firstInSession) return message;

  return [
    `You are handling GitHub issue #${issue.number} in ${repo}: ${issue.title}`,
    `Your working directory is a git worktree on branch ${branchFor(issue.number)}.`,
    "If the request needs code changes, make them and commit them. Do not push and do not open pull requests; that happens automatically after you finish.",
    "Your final message is posted as a comment on the issue, so write it for the person who asked.",
    "When a comment confirms the implementation is good, call merge_pull_request.",
    ...(trigger.kind === "comment" ? [`Issue description:\n\n${issue.body ?? ""}`] : []),
    message,
  ].join("\n\n");
}
