import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createDispatcher } from "./dispatcher.ts";
import type { GitHub } from "./github.ts";
import { handleTrigger, type Agent } from "./handler.ts";
import { initialPollState, poll, type PollState } from "./poller.ts";

export function parseRepo(remoteUrl: string) {
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) throw new Error(`${remoteUrl} is not a GitHub remote`);
  return `${match[1]}/${match[2]}`;
}

async function loadState(stateFile: string): Promise<PollState> {
  try {
    return JSON.parse(await readFile(stateFile, "utf8")) as PollState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return initialPollState(new Date());
    throw error;
  }
}

async function saveState(stateFile: string, state: PollState) {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
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
  let state = await loadState(stateFile);
  const dispatcher = createDispatcher({
    concurrency,
    handle: async (trigger) => {
      await handleTrigger(trigger, { github, agent, repoRoot });
      log(`#${trigger.issueNumber}: answered @${trigger.author}`);
    },
    onError: (trigger, error) => log(`#${trigger.issueNumber}: failed: ${error instanceof Error ? error.message : error}`),
  });

  while (!signal.aborted) {
    try {
      const result = await poll(github, state);
      state = result.state;
      await saveState(stateFile, state);
      for (const trigger of result.triggers) {
        log(`#${trigger.issueNumber}: new ${trigger.kind} from @${trigger.author}`);
        dispatcher.dispatch(trigger);
      }
    } catch (error) {
      log(`poll failed: ${error instanceof Error ? error.message : error}`);
    }
    await sleep(intervalMs, undefined, { signal }).catch(() => {});
  }

  await dispatcher.idle();
}
