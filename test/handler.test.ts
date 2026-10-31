import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createGitHub } from "../src/github.ts";
import { handleTrigger, type Agent } from "../src/handler.ts";
import type { Trigger } from "../src/poller.ts";
import { startFakeGitHub, type FakeGitHub } from "./fake-github.ts";
import { createRepos, git } from "./repos.ts";

const trigger = (body: string): Trigger => ({
  key: `comment:${body}`,
  kind: "comment",
  id: 1,
  issueNumber: 7,
  author: "alice",
  body,
  createdAt: "2026-01-03T00:00:00Z",
});

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

  describe("when the agent asks to merge", () => {
    const approving = (replies: string[]): Agent => ({
      run: async (_trigger, { requestMerge }) => {
        replies.push(await requestMerge());
        return "Merging.";
      },
    });

    async function openPullRequest() {
      await handleTrigger(trigger("add it"), { github, agent: answering("Done.", commitGreeting), repoRoot: repos.local });
    }

    it("merges the pull request with the method the repo allows and closes the issue", async () => {
      await openPullRequest();
      const replies: string[] = [];

      await handleTrigger({ ...trigger("looks good"), author: "me" }, { github, agent: approving(replies), repoRoot: repos.local });

      assert.match(replies[0]!, /will be merged/);
      assert.deepEqual(
        fake.pulls.map(({ state, merge_method }) => ({ state, merge_method })),
        [{ state: "merged", merge_method: "squash" }],
      );
      assert.equal(fake.issues.find((issue) => issue.number === 7)?.state, "closed");
      assert.equal(fake.comments.at(-1)?.body, "agent: Merging.");
    });

    it("refuses when the commenter has no write access", async () => {
      await openPullRequest();
      const replies: string[] = [];

      await handleTrigger({ ...trigger("looks good"), author: "stranger" }, { github, agent: approving(replies), repoRoot: repos.local });

      assert.match(replies[0]!, /@stranger does not have write access/);
      assert.equal(fake.pulls[0]?.state, "open");
      assert.equal(fake.issues.find((issue) => issue.number === 7)?.state, undefined);
    });

    it("says so when there is no pull request to merge", async () => {
      await handleTrigger({ ...trigger("looks good"), author: "me" }, { github, agent: approving([]), repoRoot: repos.local });

      assert.equal(fake.comments.at(-1)?.body, "agent: Merging.\n\nThere is no open pull request for this issue, so nothing was merged.");
      assert.equal(fake.issues.find((issue) => issue.number === 7)?.state, undefined);
    });
  });
});
