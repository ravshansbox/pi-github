export type Issue = {
  number: number;
  title: string;
  body: string | null;
  user: { login: string };
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
};

export type Comment = {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  html_url: string;
  issue_url: string;
};

export type GitHub = ReturnType<typeof createGitHub>;

export function createGitHub({ baseUrl, token, repo }: { baseUrl: string; token: string; repo: string }) {
  const cache = new Map<string, { etag: string; data: unknown[]; next: string | undefined }>();

  async function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(url.startsWith("http") ? url : `${baseUrl}${url}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok && response.status !== 304) {
      throw new Error(`GitHub ${method} ${url} failed: ${response.status} ${await response.text()}`);
    }
    return response;
  }

  async function list<T>(path: string): Promise<T[]> {
    const items: unknown[] = [];
    let url: string | undefined = path;
    while (url) {
      const cached = cache.get(url);
      const response = await request("GET", url, undefined, cached ? { "if-none-match": cached.etag } : {});
      if (response.status === 304 && cached) {
        items.push(...cached.data);
        url = cached.next;
        continue;
      }
      const data = (await response.json()) as unknown[];
      const next = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      const etag = response.headers.get("etag");
      if (etag) cache.set(url, { etag, data, next });
      items.push(...data);
      url = next;
    }
    return items as T[];
  }

  return {
    listIssues: (since: string) =>
      list<Issue>(`/repos/${repo}/issues?state=open&sort=updated&direction=asc&per_page=100&since=${encodeURIComponent(since)}`),
    listIssueComments: (since: string) =>
      list<Comment>(`/repos/${repo}/issues/comments?sort=updated&direction=asc&per_page=100&since=${encodeURIComponent(since)}`),
    postComment: async (issueNumber: number, body: string) => {
      await request("POST", `/repos/${repo}/issues/${issueNumber}/comments`, { body });
    },
    addReaction: async (target: { kind: "issue" | "comment"; id: number }, content: string) => {
      const path = target.kind === "issue" ? `issues/${target.id}` : `issues/comments/${target.id}`;
      await request("POST", `/repos/${repo}/${path}/reactions`, { content });
    },
    getDefaultBranch: async () => {
      const data = (await (await request("GET", `/repos/${repo}`)).json()) as { default_branch: string };
      return data.default_branch;
    },
    getIssue: async (issueNumber: number) =>
      (await (await request("GET", `/repos/${repo}/issues/${issueNumber}`)).json()) as Issue,
    hasOpenPullRequest: async (branch: string) => {
      const owner = repo.split("/")[0];
      const response = await request("GET", `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
      return ((await response.json()) as unknown[]).length > 0;
    },
    createPullRequest: async (pull: { head: string; base: string; title: string; body: string }) => {
      await request("POST", `/repos/${repo}/pulls`, pull);
    },
  };
}
