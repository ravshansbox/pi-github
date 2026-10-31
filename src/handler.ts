import type { GitHub } from "./github.ts";
import { agentPrefix, type Trigger } from "./poller.ts";

export type Agent = { run: (trigger: Trigger) => Promise<string> };

export async function handleTrigger(trigger: Trigger, { github, agent }: { github: GitHub; agent: Agent }) {
  const answer = await agent.run(trigger);
  await github.postComment(trigger.issueNumber, `${agentPrefix} ${answer}`);
}
