# pi-github

Watches open issues in a GitHub repo and answers new issues and comments with [pi](https://github.com/earendil-works/pi) agents.

## How it works

- Polls the repo of the current directory for new issues and comments every 30 seconds. Pull requests are ignored.
- Only handles issues and comments created after the first start. After a restart it picks up where it stopped, including runs a crash cut off. A crash right after posting a reply can lead to that reply being posted twice.
- Each issue gets its own git worktree in `.worktrees/issue-<number>` on branch `issue-<number>`, and its own pi session that continues across comments.
- The terminal shows each issue's progress: every tool call the agent makes, failed tool calls, and when a branch is pushed or a pull request opened.
- New issues and comments get an 👀 reaction as soon as they are picked up, then 🚀 once answered or 😕 if the run failed.
- Issues are handled in parallel, up to 3 at once. Comments on the same issue are handled one after another.
- The agent's final message is posted as a comment that starts with `agent:`. Comments that start with `agent:` are ignored, so it does not answer itself.
- If the agent made commits, the branch is pushed and a pull request is opened once. Later commits update the same pull request.
- State and sessions are kept in `.git/pi-github`.

## Requirements

- Node.js 24 or later
- [GitHub CLI](https://cli.github.com) logged in (`gh auth login`), or a `GH_TOKEN` environment variable
- pi set up with a model and credentials (`~/.pi/agent`)

## Use

```sh
cd path/to/your/repo
npx -y @ravshansbox/pi-github@latest [--interval <seconds>] [--concurrency <number>]
```

Press Ctrl+C to stop after running agents finish, or press it twice to quit at once.

## Security

Anyone who can comment on the repo can instruct an agent that has full tools on your machine and your GitHub token. The worktree only separates git changes; it is not a sandbox. Run it in a container or as a separate user with a token limited to the repo if the repo is public.
