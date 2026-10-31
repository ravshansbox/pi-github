import { branchFor, ensureWorktree, hasUnpushedCommits, pushBranch } from "./git.ts";
import type { GitHub } from "./github.ts";
import { agentPrefix, type Trigger } from "./poller.ts";

export type Agent = {
  run: (trigger: Trigger, context: { cwd: string; progress: (message: string) => void }) => Promise<string>;
};

export async function handleTrigger(
  trigger: Trigger,
  {
    github,
    agent,
    repoRoot,
    log = () => {},
  }: { github: GitHub; agent: Agent; repoRoot: string; log?: (message: string) => void },
) {
  const base = await github.getDefaultBranch();
  const worktree = await ensureWorktree(repoRoot, trigger.issueNumber, base);
  const answer = await agent.run(trigger, { cwd: worktree, progress: log });

  if (await hasUnpushedCommits(worktree, base)) {
    const branch = branchFor(trigger.issueNumber);
    await pushBranch(worktree);
    log(`pushed ${branch}`);
    if (!(await github.hasOpenPullRequest(branch))) {
      const issue = await github.getIssue(trigger.issueNumber);
      await github.createPullRequest({
        head: branch,
        base,
        title: issue.title,
        body: `${agentPrefix} Closes #${trigger.issueNumber}`,
      });
      log("opened a pull request");
    }
  }

  await github.postComment(trigger.issueNumber, `${agentPrefix} ${answer}`);
}
