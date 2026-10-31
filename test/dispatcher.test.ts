import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDispatcher } from "../src/dispatcher.ts";
import type { Trigger } from "../src/poller.ts";

const trigger = (issueNumber: number, body: string): Trigger => ({
  key: `${issueNumber}:${body}`,
  issueNumber,
  author: "alice",
  body,
  createdAt: "2026-01-03T00:00:00Z",
});

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("createDispatcher", () => {
  it("runs different issues in parallel up to the limit", async () => {
    let running = 0;
    let highest = 0;
    const dispatcher = createDispatcher({
      concurrency: 2,
      handle: async () => {
        running++;
        highest = Math.max(highest, running);
        await delay(20);
        running--;
      },
    });

    for (const issueNumber of [1, 2, 3, 4]) dispatcher.dispatch(trigger(issueNumber, "hi"));
    await dispatcher.idle();

    assert.equal(highest, 2);
  });

  it("runs triggers for the same issue one after another, in order", async () => {
    const events: string[] = [];
    const dispatcher = createDispatcher({
      concurrency: 5,
      handle: async ({ body }) => {
        events.push(`start ${body}`);
        await delay(body === "first" ? 30 : 5);
        events.push(`end ${body}`);
      },
    });

    dispatcher.dispatch(trigger(1, "first"));
    dispatcher.dispatch(trigger(1, "second"));
    await dispatcher.idle();

    assert.deepEqual(events, ["start first", "end first", "start second", "end second"]);
  });

  it("keeps going when a handler fails", async () => {
    const handled: string[] = [];
    const failures: string[] = [];
    const dispatcher = createDispatcher({
      concurrency: 1,
      handle: async ({ body }) => {
        if (body === "bad") throw new Error("boom");
        handled.push(body);
      },
      onError: (failed, error) => failures.push(`${failed.body}: ${(error as Error).message}`),
    });

    dispatcher.dispatch(trigger(1, "bad"));
    dispatcher.dispatch(trigger(1, "good"));
    await dispatcher.idle();

    assert.deepEqual(handled, ["good"]);
    assert.deepEqual(failures, ["bad: boom"]);
  });
});
