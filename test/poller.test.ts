import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createGitHub } from "../src/github.ts";
import { initialPollState, poll, type PollState } from "../src/poller.ts";
import { startFakeGitHub, type FakeGitHub } from "./fake-github.ts";

const before = "2026-01-01T00:00:00Z";
const start = new Date("2026-01-02T00:00:00Z");
const after = "2026-01-03T00:00:00Z";

describe("poll", () => {
  let fake: FakeGitHub;
  let state: PollState;
  let github: ReturnType<typeof createGitHub>;

  beforeEach(async () => {
    fake = await startFakeGitHub();
    github = createGitHub({ baseUrl: fake.url, token: "token", repo: fake.repo });
    state = initialPollState(start);
  });

  afterEach(() => fake.close());

  async function pollOnce() {
    const result = await poll(github, state);
    state = result.state;
    return result.triggers;
  }

  it("reports issues and comments created after the start", async () => {
    fake.addIssue(1, "Old", "old body", "alice", before);
    fake.addComment(1, "old comment", "alice", before);
    fake.addIssue(2, "New", "new body", "bob", after);
    fake.addComment(1, "new comment", "carol", after);

    const triggers = await pollOnce();

    assert.deepEqual(
      triggers.map(({ issueNumber, author, body }) => ({ issueNumber, author, body })),
      [
        { issueNumber: 2, author: "bob", body: "new body" },
        { issueNumber: 1, author: "carol", body: "new comment" },
      ],
    );
  });

  it("ignores pull requests and their comments", async () => {
    fake.addPullRequest(3, "A pull request", after);
    fake.addComment(3, "comment on a pull request", "bob", after);

    assert.deepEqual(await pollOnce(), []);
  });

  it("ignores comments that start with agent:", async () => {
    fake.addIssue(1, "Issue", "body", "alice", before);
    fake.addComment(1, "agent: done", "me", after);
    fake.addComment(1, "  agent: also mine", "me", after);

    assert.deepEqual(await pollOnce(), []);
  });

  it("reports each issue and comment only once", async () => {
    fake.addIssue(1, "Issue", "body", "alice", after);
    fake.addComment(1, "first", "bob", after);
    assert.equal((await pollOnce()).length, 2);

    assert.deepEqual(await pollOnce(), []);

    fake.addComment(1, "second", "bob", "2026-01-04T00:00:00Z");
    assert.deepEqual(
      (await pollOnce()).map((trigger) => trigger.body),
      ["second"],
    );
  });

  it("does not report an edited old comment", async () => {
    const comment = fake.addComment(1, "old", "alice", before);
    comment.updated_at = after;

    assert.deepEqual(await pollOnce(), []);
  });

  it("asks for changes since the newest update it has seen", async () => {
    fake.addIssue(1, "Issue", "body", "alice", after);
    await pollOnce();
    fake.requests.length = 0;

    await pollOnce();

    const paths = fake.requests.map((request) => request.path);
    assert.ok(paths.some((path) => path.includes("/issues/comments?") && path.includes(`since=${encodeURIComponent(start.toISOString())}`)));
    assert.ok(paths.some((path) => path.includes("/issues?") && path.includes(`since=${encodeURIComponent(after)}`)));
  });
});
