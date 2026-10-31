import { join } from "node:path";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { GitHub } from "./github.ts";
import type { Agent } from "./handler.ts";
import { buildPrompt } from "./prompt.ts";

export function createPiAgent({ github, repo, sessionsDir }: { github: GitHub; repo: string; sessionsDir: string }): Agent {
  return {
    async run(trigger, { cwd }) {
      const sessionManager = SessionManager.continueRecent(cwd, join(sessionsDir, `issue-${trigger.issueNumber}`));
      const { session } = await createAgentSession({ cwd, sessionManager });
      try {
        const issue = await github.getIssue(trigger.issueNumber);
        const firstInSession = session.messages.length === 0;
        await session.prompt(buildPrompt({ repo, issue, trigger, firstInSession }));
        return session.getLastAssistantText() ?? "";
      } finally {
        session.dispose();
      }
    },
  };
}
