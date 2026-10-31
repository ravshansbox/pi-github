import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createDispatcher } from "./dispatcher.ts";
import type { GitHub } from "./github.ts";
import { handleTrigger, type Agent } from "./handler.ts";
import { initialPollState, poll, type PollState, type Trigger } from "./poller.ts";

export function parseRepo(remoteUrl: string) {
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) throw new Error(`${remoteUrl} is not a GitHub remote`);
  return `${match[1]}/${match[2]}`;
}

type WatchState = PollState & { pending?: Trigger[] };

async function loadState(stateFile: string): Promise<WatchState> {
  try {
    return JSON.parse(await readFile(stateFile, "utf8")) as WatchState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return initialPollState(new Date());
    throw error;
  }
}

async function saveState(stateFile: string, state: WatchState) {
  await mkdir(dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporaryFile, stateFile);
}

export async function watch({
  github,
  agent,
  repoRoot,
  stateFile,
  intervalMs,
  concurrency,
  signal,
  log,
}: {
  github: GitHub;
  agent: Agent;
  repoRoot: string;
  stateFile: string;
  intervalMs: number;
  concurrency: number;
  signal: AbortSignal;
  log: (message: string) => void;
}) {
  let { pending = [], ...pollState } = await loadState(stateFile);
  let saving = Promise.resolve();
  const save = () => (saving = saving.then(() => saveState(stateFile, { ...pollState, pending })));

  const dispatcher = createDispatcher({
    concurrency,
    handle: async (trigger) => {
      try {
        await handleTrigger(trigger, { github, agent, repoRoot });
        log(`#${trigger.issueNumber}: answered @${trigger.author}`);
      } finally {
        pending = pending.filter((candidate) => candidate.key !== trigger.key);
        await save();
      }
    },
    onError: (trigger, error) => log(`#${trigger.issueNumber}: failed: ${error instanceof Error ? error.message : error}`),
  });

  for (const trigger of pending) {
    log(`#${trigger.issueNumber}: resuming ${trigger.kind} from @${trigger.author}`);
    dispatcher.dispatch(trigger);
  }

  while (!signal.aborted) {
    try {
      const result = await poll(github, pollState);
      pollState = result.state;
      pending = [...pending, ...result.triggers];
      await save();
      for (const trigger of result.triggers) {
        log(`#${trigger.issueNumber}: new ${trigger.kind} from @${trigger.author}`);
        dispatcher.dispatch(trigger);
        await github.addReaction(trigger, "eyes").catch((error) => log(`#${trigger.issueNumber}: reaction failed: ${error instanceof Error ? error.message : error}`));
      }
    } catch (error) {
      log(`poll failed: ${error instanceof Error ? error.message : error}`);
    }
    await sleep(intervalMs, undefined, { signal }).catch(() => {});
  }

  await dispatcher.idle();
}
