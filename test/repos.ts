import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

export function createRepos() {
  const root = mkdtempSync(join(tmpdir(), "pi-github-"));
  const remote = join(root, "remote.git");
  const local = join(root, "local");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "clone", "-q", remote, local);
  git(local, "config", "user.email", "test@example.com");
  git(local, "config", "user.name", "Test");
  writeFileSync(join(local, "README.md"), "hello\n");
  git(local, "add", ".");
  git(local, "commit", "-qm", "initial");
  git(local, "push", "-q", "origin", "main");
  return { remote, local };
}
