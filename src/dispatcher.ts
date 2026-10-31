import type { Trigger } from "./poller.ts";

export function createDispatcher({
  concurrency,
  handle,
  onError = () => {},
}: {
  concurrency: number;
  handle: (trigger: Trigger) => Promise<void>;
  onError?: (trigger: Trigger, error: unknown) => void;
}) {
  const queues = new Map<number, Trigger[]>();
  const waiting: number[] = [];
  const active = new Set<number>();
  let idleWaiters: (() => void)[] = [];

  function pump() {
    while (active.size < concurrency && waiting.length > 0) {
      const issueNumber = waiting.shift()!;
      active.add(issueNumber);
      void drain(issueNumber);
    }
    if (active.size === 0 && waiting.length === 0) {
      for (const resolve of idleWaiters) resolve();
      idleWaiters = [];
    }
  }

  async function drain(issueNumber: number) {
    const queue = queues.get(issueNumber)!;
    while (queue.length > 0) {
      const trigger = queue.shift()!;
      try {
        await handle(trigger);
      } catch (error) {
        onError(trigger, error);
      }
    }
    queues.delete(issueNumber);
    active.delete(issueNumber);
    pump();
  }

  return {
    dispatch(trigger: Trigger) {
      const queue = queues.get(trigger.issueNumber);
      if (queue) {
        queue.push(trigger);
        return;
      }
      queues.set(trigger.issueNumber, [trigger]);
      waiting.push(trigger.issueNumber);
      pump();
    },
    idle() {
      if (active.size === 0 && waiting.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };
}
