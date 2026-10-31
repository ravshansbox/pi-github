import { branchFor, ensureWorktree, hasUnpushedCommits, pushBranch } from "./git.ts";
import type { GitHub } from "./github.ts";
import { agentPrefix, type Trigger } from "./poller.ts";

export type Agent = { run: (trigger: Trigger, context: { cwd: string }) => Promise<string> };

export async function handleTrigger(
  trigger: Trigger,
  { github, agent, repoRoot }: { github: GitHub; agent: Agent; repoRoot: string },
) {
  const base = await github.getDefaultBranch();
  const worktree = await ensureWorktree(repoRoot, trigger.issueNumber, base);
  const answer = await agent.run(trigger, { cwd: worktree });

  if (await hasUnpushedCommits(worktree, base)) {
    await pushBranch(worktree);
    const branch = branchFor(trigger.issueNumber);
    if (!(await github.hasOpenPullRequest(branch))) {
      const issue = await github.getIssue(trigger.issueNumber);
      await github.createPullRequest({
        head: branch,
        base,
        title: issue.title,
        body: `${agentPrefix} Closes #${trigger.issueNumber}`,
      });
    }
  }

  await github.postComment(trigger.issueNumber, `${agentPrefix} ${answer}`);
}
