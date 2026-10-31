import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeToolCall } from "../src/progress.ts";

describe("describeToolCall", () => {
  it("shows the first line of a bash command", () => {
    assert.equal(describeToolCall("bash", { command: "npm test\necho done" }), "bash: npm test");
  });

  it("shows the path or pattern of file tools", () => {
    assert.equal(describeToolCall("read", { path: "src/app.ts", offset: 10 }), "read: src/app.ts");
    assert.equal(describeToolCall("grep", { pattern: "TODO" }), "grep: TODO");
  });

  it("shows the arguments of other tools as JSON", () => {
    assert.equal(describeToolCall("custom", { level: 2 }), 'custom: {"level":2}');
  });

  it("shortens long lines", () => {
    const line = describeToolCall("bash", { command: "x".repeat(300) });
    assert.equal(line.length, "bash: ".length + 100);
    assert.ok(line.endsWith("…"));
  });
});
