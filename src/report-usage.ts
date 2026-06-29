import type {
  ClientRollup,
  ProjectRollup,
  SessionUsage,
  TokenUsage,
  UsageReport,
} from "./usage.js";

export interface UsageRenderOptions {
  topSessions?: number;
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtUsage(u: TokenUsage): string {
  return (
    `in ${fmtInt(u.input)}  ` +
    `cache(r/w) ${fmtInt(u.cacheRead)}/${fmtInt(u.cacheCreation)}  ` +
    `out ${fmtInt(u.output)}  ` +
    `turns ${fmtInt(u.turns)}`
  );
}

function sortProjects(projects: ProjectRollup[]): ProjectRollup[] {
  return [...projects].sort((a, b) => b.total.output - a.total.output);
}

function sortClients(clients: ClientRollup[]): ClientRollup[] {
  return [...clients].sort((a, b) => b.total.output - a.total.output);
}

function sortSessionsByOutput(sessions: SessionUsage[]): SessionUsage[] {
  return [...sessions].sort((a, b) => b.total.output - a.total.output);
}

export function renderUsageText(report: UsageReport, opts: UsageRenderOptions = {}): string {
  const topN = opts.topSessions ?? 10;
  const lines: string[] = [];

  lines.push(
    `sessionguard usage report — ${fmtInt(report.sessionsScanned)} session${report.sessionsScanned === 1 ? "" : "s"} / ${fmtInt(report.eventsScanned)} events`,
  );
  lines.push(`total  ${fmtUsage(report.total)}`);
  lines.push("");

  if (report.byClient.length) {
    lines.push("by client (sorted by output tokens):");
    for (const c of sortClients(report.byClient)) {
      lines.push(`  ${c.tag}  [${c.sessions.length} session${c.sessions.length === 1 ? "" : "s"}]`);
      lines.push(`    ${fmtUsage(c.total)}`);
    }
    lines.push("");
  }

  if (report.byProject.length) {
    lines.push("by project (sorted by output tokens):");
    for (const p of sortProjects(report.byProject)) {
      lines.push(`  ${p.cwd}  [${p.sessions.length} session${p.sessions.length === 1 ? "" : "s"}]`);
      lines.push(`    ${fmtUsage(p.total)}`);
    }
    lines.push("");
  }

  const models = Object.entries(report.byModel).sort((a, b) => b[1].output - a[1].output);
  if (models.length) {
    lines.push("by model:");
    for (const [model, tokens] of models) {
      lines.push(`  ${model}  ${fmtUsage(tokens)}`);
    }
    lines.push("");
  }

  const top = sortSessionsByOutput(report.sessions).slice(0, topN);
  if (top.length) {
    lines.push(`top ${top.length} session${top.length === 1 ? "" : "s"} by output tokens:`);
    for (const s of top) {
      const when = s.firstTimestamp ? s.firstTimestamp.slice(0, 16).replace("T", " ") : "—";
      lines.push(`  ${when}  ${s.path}`);
      lines.push(`    ${fmtUsage(s.total)}`);
    }
  }

  return lines.join("\n");
}

export function renderUsageJson(report: UsageReport): string {
  return JSON.stringify(report, null, 2);
}
