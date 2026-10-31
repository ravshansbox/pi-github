#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { git } from "./git.ts";
import { createGitHub } from "./github.ts";
import { createPiAgent } from "./pi-agent.ts";
import { parseRepo, watch } from "./watch.ts";

const { values } = parseArgs({
  options: {
    interval: { type: "string", default: "30" },
    concurrency: { type: "string", default: "3" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`Usage: pi-github [--interval <seconds>] [--concurrency <number>]

Watches open issues in the GitHub repo of the current directory and answers new issues and comments with pi agents.

Options:
  --interval <seconds>     Time between polls (default: 30)
  --concurrency <number>   Most issues handled at once (default: 3)`);
  process.exit(0);
}

const repoRoot = await git(process.cwd(), "rev-parse", "--show-toplevel");
const repo = parseRepo(await git(repoRoot, "remote", "get-url", "origin"));
const token = process.env.GH_TOKEN ?? execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const dataDir = join(await git(repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"), "pi-github");
const github = createGitHub({ baseUrl: "https://api.github.com", token, repo });
const agent = createPiAgent({ github, repo, sessionsDir: join(dataDir, "sessions") });

const controller = new AbortController();
process.on("SIGINT", () => {
  if (controller.signal.aborted) process.exit(130);
  console.log("Stopping after running agents finish. Press Ctrl+C again to quit now.");
  controller.abort();
});

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);
log(`Watching ${repo}`);
await watch({
  github,
  agent,
  repoRoot,
  stateFile: join(dataDir, "state.json"),
  intervalMs: Number(values.interval) * 1000,
  concurrency: Number(values.concurrency),
  signal: controller.signal,
  log,
});
