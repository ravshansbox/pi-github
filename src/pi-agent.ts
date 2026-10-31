import { join } from "node:path";
import { createAgentSession, defineTool, SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { GitHub } from "./github.ts";
import type { Agent } from "./handler.ts";
import { describeToolCall } from "./progress.ts";
import { buildPrompt } from "./prompt.ts";

export function createPiAgent({ github, repo, sessionsDir }: { github: GitHub; repo: string; sessionsDir: string }): Agent {
  return {
    async run(trigger, { cwd, progress, requestMerge }) {
      const sessionManager = SessionManager.continueRecent(cwd, join(sessionsDir, `issue-${trigger.issueNumber}`));
      const mergeTool = defineTool({
        name: "merge_pull_request",
        label: "Merge pull request",
        description:
          "Merge this issue's pull request into the default branch and close the issue, once you have finished. Call it only when the latest comment confirms the implementation is good.",
        parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: "text", text: await requestMerge() }], details: {} }),
      });
      const { session } = await createAgentSession({ cwd, sessionManager, customTools: [mergeTool] });
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "tool_execution_start" && !event.parentToolCallId) progress(describeToolCall(event.toolName, event.args));
        if (event.type === "tool_execution_end" && event.isError && !event.parentToolCallId) progress(`${event.toolName} failed`);
      });
      try {
        const issue = await github.getIssue(trigger.issueNumber);
        const firstInSession = session.messages.length === 0;
        await session.prompt(buildPrompt({ repo, issue, trigger, firstInSession }));
        return session.getLastAssistantText() ?? "";
      } finally {
        unsubscribe();
        session.dispose();
      }
    },
  };
}
