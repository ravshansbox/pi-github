const maximumLength = 100;

export function describeToolCall(toolName: string, args: unknown) {
  const values = args !== null && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const detail =
    ["command", "path", "pattern", "query"].map((key) => values[key]).find((value): value is string => typeof value === "string") ??
    JSON.stringify(args ?? {});
  const line = detail.split("\n")[0] ?? "";
  return `${toolName}: ${line.length > maximumLength ? `${line.slice(0, maximumLength - 1)}…` : line}`;
}
