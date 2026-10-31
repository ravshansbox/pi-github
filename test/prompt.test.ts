import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPrompt } from "../src/prompt.ts";

const issue = { number: 7, title: "Add a greeting", body: "Please add a greeting." };

describe("buildPrompt", () => {
  it("introduces the issue and the rules in a new session", () => {
    const prompt = buildPrompt({
      repo: "owner/repo",
      issue,
      trigger: { kind: "issue", author: "alice", body: "Please add a greeting." },
      firstInSession: true,
    });

    assert.match(prompt, /GitHub issue #7 in owner\/repo: Add a greeting/);
    assert.match(prompt, /branch issue-7/);
    assert.match(prompt, /commit/i);
    assert.match(prompt, /do not push/i);
    assert.match(prompt, /final message is posted as a comment/i);
    assert.match(prompt, /New issue from @alice:\n\nPlease add a greeting\./);
  });

  it("includes the issue body when a comment starts the session", () => {
    const prompt = buildPrompt({
      repo: "owner/repo",
      issue,
      trigger: { kind: "comment", author: "bob", body: "Any update?" },
      firstInSession: true,
    });

    assert.match(prompt, /Issue description:\n\nPlease add a greeting\./);
    assert.match(prompt, /New comment from @bob:\n\nAny update\?/);
  });

  it("sends only the new comment in an existing session", () => {
    const prompt = buildPrompt({
      repo: "owner/repo",
      issue,
      trigger: { kind: "comment", author: "bob", body: "Any update?" },
      firstInSession: false,
    });

    assert.equal(prompt, "New comment from @bob:\n\nAny update?");
  });
});
