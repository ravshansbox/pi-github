import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createGitHub } from "../src/github.ts";
import type { Agent } from "../src/handler.ts";
import { parseRepo, watch } from "../src/watch.ts";
import { startFakeGitHub, type FakeGitHub } from "./fake-github.ts";
import { createRepos } from "./repos.ts";

describe("parseRepo", () => {
  it("reads owner/repo from https and ssh remotes", () => {
    assert.equal(parseRepo("https://github.com/owner/repo.git"), "owner/repo");
    assert.equal(parseRepo("https://github.com/owner/repo"), "owner/repo");
    assert.equal(parseRepo("git@github.com:owner/repo.git"), "owner/repo");
    assert.equal(parseRepo("ssh://git@github.com/owner/repo.git"), "owner/repo");
  });

  it("rejects remotes that are not on GitHub", () => {
    assert.throws(() => parseRepo("https://gitlab.com/owner/repo.git"), /not a GitHub remote/);
  });
});

describe("watch", () => {
  let fake: FakeGitHub;
  let repoRoot: string;
  let stateFile: string;
  const answered: string[] = [];
  const agent: Agent = {
    run: async (trigger) => {
      answered.push(trigger.body);
      return `Re: ${trigger.body}`;
    },
  };

  beforeEach(async () => {
    fake = await startFakeGitHub();
    repoRoot = createRepos().local;
    stateFile = join(mkdtempSync(join(tmpdir(), "pi-github-state-")), "state.json");
    answered.length = 0;
  });

  afterEach(() => fake.close());

  async function runUntil(done: () => boolean, { use = agent, crash = false }: { use?: Agent; crash?: boolean } = {}) {
    const controller = new AbortController();
    const github = createGitHub({ baseUrl: fake.url, token: "token", repo: fake.repo });
    const running = watch({ github, agent: use, repoRoot, stateFile, intervalMs: 10, concurrency: 2, signal: controller.signal, log: () => {} });
    const deadline = Date.now() + 5000;
    while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    if (!crash) await running;
  }

  it("answers comments created while it runs, but not older ones", async () => {
    fake.addIssue(1, "Issue", "body", "alice", "2020-01-01T00:00:00Z");
    fake.addComment(1, "before start", "alice", "2020-01-01T00:00:00Z");

    await runUntil(() => {
      if (fake.comments.length === 1 && fake.requests.length > 0) fake.addComment(1, "after start", "bob");
      return fake.comments.some((comment) => comment.body.startsWith("agent:"));
    });

    assert.deepEqual(answered, ["after start"]);
    assert.ok(fake.comments.some((comment) => comment.body === "agent: Re: after start"));
  });

  it("after a restart, answers comments posted while stopped, and nothing twice", async () => {
    fake.addIssue(1, "Issue", "body", "alice", "2020-01-01T00:00:00Z");
    await runUntil(() => {
      if (fake.comments.length === 0 && fake.requests.length > 0) fake.addComment(1, "hello", "bob");
      return answered.length === 1;
    });

    fake.addComment(1, "while stopped", "bob");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runUntil(() => answered.length === 2);

    assert.deepEqual(answered, ["hello", "while stopped"]);
  });

  it("after a crash, answers the comment whose run was cut off", async () => {
    fake.addIssue(1, "Issue", "body", "alice", "2020-01-01T00:00:00Z");
    let started = false;
    const hanging: Agent = {
      run: () => {
        started = true;
        return new Promise(() => {});
      },
    };
    await runUntil(
      () => {
        if (fake.comments.length === 0 && fake.requests.length > 0) fake.addComment(1, "cut off", "bob");
        return started;
      },
      { use: hanging, crash: true },
    );

    await runUntil(() => answered.length === 1);

    assert.deepEqual(answered, ["cut off"]);
    assert.ok(fake.comments.some((comment) => comment.body === "agent: Re: cut off"));
  });

  it("reacts with eyes to a new issue or comment as soon as it picks it up", async () => {
    fake.addIssue(1, "Old issue", "body", "alice", "2020-01-01T00:00:00Z");
    const hanging: Agent = { run: () => new Promise(() => {}) };
    let comment: ReturnType<FakeGitHub["addComment"]> | undefined;
    await runUntil(
      () => {
        if (!comment && fake.requests.length > 0) {
          comment = fake.addComment(1, "please look", "bob");
          fake.addIssue(2, "New issue", "body", "bob");
        }
        return fake.reactions.length === 2;
      },
      { use: hanging, crash: true },
    );

    assert.deepEqual(
      [...fake.reactions].sort((left, right) => left.target.localeCompare(right.target)),
      [
        { target: `comment:${comment!.id}`, content: "eyes" },
        { target: "issue:2", content: "eyes" },
      ],
    );
  });
});
