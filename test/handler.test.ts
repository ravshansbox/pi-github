import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createGitHub } from "../src/github.ts";
import { handleTrigger } from "../src/handler.ts";
import type { Trigger } from "../src/poller.ts";
import { startFakeGitHub, type FakeGitHub } from "./fake-github.ts";

const trigger: Trigger = {
  key: "comment:1",
  issueNumber: 7,
  author: "alice",
  body: "What does this repo do?",
  createdAt: "2026-01-03T00:00:00Z",
};

describe("handleTrigger", () => {
  let fake: FakeGitHub;

  beforeEach(async () => {
    fake = await startFakeGitHub();
  });

  afterEach(() => fake.close());

  it("posts the agent's answer as an agent: comment on the issue", async () => {
    const github = createGitHub({ baseUrl: fake.url, token: "token", repo: fake.repo });
    const received: Trigger[] = [];
    const agent = {
      run: async (input: Trigger) => {
        received.push(input);
        return "It is a demo.";
      },
    };

    await handleTrigger(trigger, { github, agent });

    assert.deepEqual(received, [trigger]);
    assert.deepEqual(
      fake.comments.map((comment) => ({ issue: comment.issue_url.split("/").pop(), body: comment.body })),
      [{ issue: "7", body: "agent: It is a demo." }],
    );
  });
});
