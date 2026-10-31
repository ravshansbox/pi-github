import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

type User = { login: string };

export type FakeIssue = {
  number: number;
  title: string;
  body: string | null;
  user: User;
  created_at: string;
  updated_at: string;
  pull_request?: { url: string };
};

export type FakeComment = {
  id: number;
  body: string;
  user: User;
  created_at: string;
  updated_at: string;
  html_url: string;
  issue_url: string;
};

export type RecordedRequest = { method: string; path: string; body: unknown };

export async function startFakeGitHub(repo = "owner/repo") {
  const issues: FakeIssue[] = [];
  const comments: FakeComment[] = [];
  const pulls: { number: number; head: string; base: string; title: string; body: string }[] = [];
  const requests: RecordedRequest[] = [];
  const reactions: { target: string; content: string }[] = [];
  let nextId = 1000;

  const readBody = async (request: IncomingMessage) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    return text ? JSON.parse(text) : undefined;
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const body = await readBody(request);
    requests.push({ method: request.method ?? "GET", path: url.pathname + url.search, body });
    const prefix = `/repos/${repo}`;
    const since = url.searchParams.get("since") ?? "";

    const sendList = (items: unknown[]) => {
      const text = JSON.stringify(items);
      const etag = `"${createHash("sha1").update(text).digest("hex")}"`;
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304, { etag }).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json", etag }).end(text);
    };
    const sendJson = (status: number, data: unknown) => {
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));
    };

    if (request.method === "GET" && url.pathname === prefix) {
      sendJson(200, { default_branch: "main" });
      return;
    }
    if (request.method === "GET" && url.pathname === `${prefix}/issues/comments`) {
      sendList(comments.filter((comment) => comment.updated_at >= since));
      return;
    }
    if (request.method === "GET" && url.pathname === `${prefix}/issues`) {
      sendList(issues.filter((issue) => issue.updated_at >= since));
      return;
    }
    const issueMatch = url.pathname.match(new RegExp(`^${prefix}/issues/(\\d+)$`));
    if (request.method === "GET" && issueMatch) {
      const issue = issues.find((candidate) => candidate.number === Number(issueMatch[1]));
      sendJson(issue ? 200 : 404, issue ?? { message: "Not Found" });
      return;
    }
    if (request.method === "GET" && url.pathname === `${prefix}/pulls`) {
      const head = url.searchParams.get("head") ?? "";
      sendJson(200, pulls.filter((pull) => `${repo.split("/")[0]}:${pull.head}` === head));
      return;
    }
    const commentMatch = url.pathname.match(new RegExp(`^${prefix}/issues/(\\d+)/comments$`));
    if (request.method === "POST" && commentMatch) {
      const issueNumber = Number(commentMatch[1]);
      const created = addComment(issueNumber, body.body, "me");
      sendJson(201, created);
      return;
    }
    const commentReactionMatch = url.pathname.match(new RegExp(`^${prefix}/issues/comments/(\\d+)/reactions$`));
    const issueReactionMatch = url.pathname.match(new RegExp(`^${prefix}/issues/(\\d+)/reactions$`));
    if (request.method === "POST" && (commentReactionMatch || issueReactionMatch)) {
      const target = commentReactionMatch ? `comment:${commentReactionMatch[1]}` : `issue:${issueReactionMatch![1]}`;
      reactions.push({ target, content: body.content });
      sendJson(201, { content: body.content });
      return;
    }
    if (request.method === "POST" && url.pathname === `${prefix}/pulls`) {
      const pull = { number: 500 + pulls.length, ...body };
      pulls.push(pull);
      sendJson(201, { number: pull.number, html_url: `https://github.com/${repo}/pull/${pull.number}` });
      return;
    }
    sendJson(404, { message: "Not Found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  function addIssue(number: number, title: string, body: string, login = "someone", at = new Date().toISOString()) {
    const issue: FakeIssue = { number, title, body, user: { login }, created_at: at, updated_at: at };
    issues.push(issue);
    return issue;
  }

  function addPullRequest(number: number, title: string, at = new Date().toISOString()) {
    const issue = addIssue(number, title, "", "someone", at);
    issue.pull_request = { url: `https://api.github.com/repos/${repo}/pulls/${number}` };
    return issue;
  }

  function addComment(issueNumber: number, body: string, login = "someone", at = new Date().toISOString()) {
    const id = nextId++;
    const isPull = issues.some((issue) => issue.number === issueNumber && issue.pull_request);
    const comment: FakeComment = {
      id,
      body,
      user: { login },
      created_at: at,
      updated_at: at,
      html_url: `https://github.com/${repo}/${isPull ? "pull" : "issues"}/${issueNumber}#issuecomment-${id}`,
      issue_url: `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
    };
    comments.push(comment);
    return comment;
  }

  return {
    url: `http://127.0.0.1:${port}`,
    repo,
    issues,
    comments,
    pulls,
    reactions,
    requests,
    addIssue,
    addPullRequest,
    addComment,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type FakeGitHub = Awaited<ReturnType<typeof startFakeGitHub>>;
