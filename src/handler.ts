import { branchFor, ensureWorktree, hasUnpushedCommits, pushBranch } from "./git.ts";
import type { GitHub } from "./github.ts";
import { agentPrefix, type Trigger } from "./poller.ts";

export type Agent = {
  run: (
    trigger: Trigger,
    context: { cwd: string; progress: (message: string) => void; requestMerge: () => Promise<string> },
  ) => Promise<string>;
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
  const branch = branchFor(trigger.issueNumber);
  const worktree = await ensureWorktree(repoRoot, trigger.issueNumber, base);
  let mergeRequested = false;
  const requestMerge = async () => {
    if (!(await github.hasWriteAccess(trigger.author))) {
      return `@${trigger.author} does not have write access, so the pull request will not be merged.`;
    }
    mergeRequested = true;
    return "The pull request will be merged after you finish, which closes the issue.";
  };
  const answer = await agent.run(trigger, { cwd: worktree, progress: log, requestMerge });

  if (await hasUnpushedCommits(worktree, base)) {
    await pushBranch(worktree);
    log(`pushed ${branch}`);
    if ((await github.findOpenPullRequest(branch)) === undefined) {
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

  let note = "";
  if (mergeRequested) {
    const pullNumber = await github.findOpenPullRequest(branch);
    if (pullNumber === undefined) {
      note = "\n\nThere is no open pull request for this issue, so nothing was merged.";
    } else {
      try {
        await github.mergePullRequest(pullNumber, await github.getMergeMethod());
        log(`merged pull request #${pullNumber}`);
      } catch (error) {
        note = `\n\nMerging failed: ${error instanceof Error ? error.message : error}`;
      }
    }
  }

  await github.postComment(trigger.issueNumber, `${agentPrefix} ${answer}${note}`);
}
