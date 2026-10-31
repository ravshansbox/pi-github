import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createGitHub } from "../src/github.ts";
import { handleTrigger, type Agent } from "../src/handler.ts";
import type { Trigger } from "../src/poller.ts";
import { startFakeGitHub, type FakeGitHub } from "./fake-github.ts";

const trigger = (body: string): Trigger => ({
  key: `comment:${body}`,
  issueNumber: 7,
  author: "alice",
  body,
  createdAt: "2026-01-03T00:00:00Z",
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function createRepos() {
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

describe("handleTrigger", () => {
  let fake: FakeGitHub;
  let repos: ReturnType<typeof createRepos>;
  let github: ReturnType<typeof createGitHub>;

  beforeEach(async () => {
    fake = await startFakeGitHub();
    fake.addIssue(7, "Add a greeting", "Please add a greeting", "alice", "2026-01-03T00:00:00Z");
    github = createGitHub({ baseUrl: fake.url, token: "token", repo: fake.repo });
    repos = createRepos();
  });

  afterEach(() => fake.close());

  const answering = (answer: string, work: (cwd: string) => void = () => {}): Agent => ({
    run: async (_trigger, { cwd }) => {
      work(cwd);
      return answer;
    },
  });

  const commitGreeting = (cwd: string) => {
    writeFileSync(join(cwd, "greeting.txt"), "hi\n");
    git(cwd, "add", ".");
    git(cwd, "-c", "user.email=agent@example.com", "-c", "user.name=Agent", "commit", "-qm", "feat: add greeting");
  };

  it("posts the agent's answer as an agent: comment on the issue", async () => {
    await handleTrigger(trigger("What does this repo do?"), { github, agent: answering("It is a demo."), repoRoot: repos.local });

    assert.deepEqual(
      fake.comments.map((comment) => ({ issue: comment.issue_url.split("/").pop(), body: comment.body })),
      [{ issue: "7", body: "agent: It is a demo." }],
    );
  });

  it("runs the agent in a worktree for the issue, based on the default branch", async () => {
    let seenCwd = "";
    let seenBranch = "";
    const agent: Agent = {
      run: async (_trigger, { cwd }) => {
        seenCwd = cwd;
        seenBranch = git(cwd, "branch", "--show-current");
        return "ok";
      },
    };

    await handleTrigger(trigger("hi"), { github, agent, repoRoot: repos.local });

    assert.equal(seenCwd, join(repos.local, ".worktrees", "issue-7"));
    assert.equal(seenBranch, "issue-7");
    assert.equal(git(repos.local, "status", "--porcelain"), "");
  });

  it("pushes new commits and opens a pull request once", async () => {
    await handleTrigger(trigger("add it"), { github, agent: answering("Done.", commitGreeting), repoRoot: repos.local });

    assert.equal(git(repos.remote, "log", "-1", "--format=%s", "issue-7"), "feat: add greeting");
    assert.deepEqual(
      fake.pulls.map(({ head, base, title, body }) => ({ head, base, title, body })),
      [{ head: "issue-7", base: "main", title: "Add a greeting", body: "agent: Closes #7" }],
    );

    await handleTrigger(trigger("tweak it"), {
      github,
      agent: answering("Tweaked.", (cwd) => {
        writeFileSync(join(cwd, "greeting.txt"), "hello\n");
        git(cwd, "-c", "user.email=agent@example.com", "-c", "user.name=Agent", "commit", "-qam", "fix: tweak greeting");
      }),
      repoRoot: repos.local,
    });

    assert.equal(git(repos.remote, "log", "-1", "--format=%s", "issue-7"), "fix: tweak greeting");
    assert.equal(fake.pulls.length, 1);
  });

  it("does not push or open a pull request without new commits", async () => {
    await handleTrigger(trigger("just a question"), { github, agent: answering("Answer."), repoRoot: repos.local });

    assert.equal(git(repos.remote, "branch", "--list", "issue-7"), "");
    assert.equal(fake.pulls.length, 0);
  });
});
