import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function git(cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

export const branchFor = (issueNumber: number) => `issue-${issueNumber}`;

async function excludeWorktrees(repoRoot: string) {
  const exclude = join(await git(repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"), "info", "exclude");
  const current = existsSync(exclude) ? await readFile(exclude, "utf8") : "";
  if (current.split("\n").includes("/.worktrees/")) return;
  await mkdir(join(exclude, ".."), { recursive: true });
  await appendFile(exclude, `${current === "" || current.endsWith("\n") ? "" : "\n"}/.worktrees/\n`);
}

export async function ensureWorktree(repoRoot: string, issueNumber: number, base: string) {
  const path = join(repoRoot, ".worktrees", `issue-${issueNumber}`);
  if (existsSync(path)) return path;
  await excludeWorktrees(repoRoot);
  const branch = branchFor(issueNumber);
  await git(repoRoot, "fetch", "-q", "origin", base);
  const branchExists = (await git(repoRoot, "branch", "--list", branch)) !== "";
  if (branchExists) await git(repoRoot, "worktree", "add", "-q", path, branch);
  else await git(repoRoot, "worktree", "add", "-q", "-b", branch, path, `origin/${base}`);
  return path;
}

export async function hasUnpushedCommits(worktree: string, base: string) {
  const branch = await git(worktree, "branch", "--show-current");
  const remoteBranch = (await git(worktree, "ls-remote", "--heads", "origin", branch)) !== "";
  const compareWith = remoteBranch ? `origin/${branch}` : `origin/${base}`;
  if (remoteBranch) await git(worktree, "fetch", "-q", "origin", branch);
  return Number(await git(worktree, "rev-list", "--count", `${compareWith}..HEAD`)) > 0;
}

export async function pushBranch(worktree: string) {
  const branch = await git(worktree, "branch", "--show-current");
  await git(worktree, "push", "-q", "-u", "origin", branch);
}
