import type { GitHub } from "./github.ts";

export type Trigger = {
  key: string;
  issueNumber: number;
  author: string;
  body: string;
  createdAt: string;
};

export type PollState = {
  startedAt: string;
  issuesSince: string;
  commentsSince: string;
  seen: string[];
};

export const agentPrefix = "agent:";

export function initialPollState(now: Date): PollState {
  const startedAt = now.toISOString();
  return { startedAt, issuesSince: startedAt, commentsSince: startedAt, seen: [] };
}

const newest = (since: string, items: { updated_at: string }[]) =>
  items.reduce((latest, item) => (item.updated_at > latest ? item.updated_at : latest), since);

export async function poll(github: GitHub, state: PollState): Promise<{ triggers: Trigger[]; state: PollState }> {
  const [issues, comments] = await Promise.all([
    github.listIssues(state.issuesSince),
    github.listIssueComments(state.commentsSince),
  ]);

  const candidates: Trigger[] = [
    ...issues
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        key: `issue:${issue.number}`,
        issueNumber: issue.number,
        author: issue.user.login,
        body: issue.body ?? "",
        createdAt: issue.created_at,
      })),
    ...comments
      .filter((comment) => !comment.html_url.includes("/pull/"))
      .map((comment) => ({
        key: `comment:${comment.id}`,
        issueNumber: Number(comment.issue_url.split("/").pop()),
        author: comment.user.login,
        body: comment.body,
        createdAt: comment.created_at,
      })),
  ];

  const seen = new Set(state.seen);
  const triggers = candidates
    .filter((trigger) => trigger.createdAt >= state.startedAt)
    .filter((trigger) => !trigger.body.trimStart().startsWith(agentPrefix))
    .filter((trigger) => !seen.has(trigger.key))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  return {
    triggers,
    state: {
      ...state,
      issuesSince: newest(state.issuesSince, issues),
      commentsSince: newest(state.commentsSince, comments),
      seen: [...state.seen, ...triggers.map((trigger) => trigger.key)],
    },
  };
}
