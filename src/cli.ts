#!/usr/bin/env node
import { scanPaths } from "./engine.js";
import { filterScanResultBySince, filterUsageReportBySince } from "./filter.js";
import { discoverSessions } from "./parser.js";
import { renderJson, renderText } from "./report.js";
import { renderUsageCsv } from "./report-csv.js";
import { renderUsageJson, renderUsageText } from "./report-usage.js";
import { DEFAULT_RULES } from "./rules/index.js";
import { parseSince } from "./since.js";
import { compileTagger, defaultTagConfigPath, loadTagConfig, noopTagger } from "./tagger.js";
import type { Severity } from "./types.js";
import { analyzePaths } from "./usage.js";

type OutputFormat = "text" | "json" | "csv";

interface ParsedArgs {
  command: string;
  paths: string[];
  format: OutputFormat;
  noColor: boolean;
  minSeverity: Severity;
  groupBy: "session" | "rule";
  topSessions: number;
  since?: Date;
  tagConfig?: string;
  help: boolean;
  version: boolean;
}

const USAGE = `sessionguard — local governance for AI coding agent sessions

Usage:
  sessionguard audit [paths...]   scan session transcripts for security findings
  sessionguard report [paths...]  token / project / model usage report
  sessionguard rules              list available audit rules
  sessionguard --help             show this help

Options:
  --json                        machine-readable JSON (alias for --format json)
  --csv                         CSV for spreadsheets / invoicing (report only; alias for --format csv)
  --format <text|json|csv>      output format (default: text; csv available for report only)
  --no-color                    disable ANSI colour in text output (audit only)
  --min <severity>              info|low|medium|high|critical (audit, default: info)
  --group-by <session|rule>     grouping for text output (audit, default: session)
  --top <n>                     top-N sessions to list (report, default: 10)
  --since <duration|date>       limit to sessions active on/after (e.g. 7d, 24h, 2026-04-01)
  --tag-config <path>           client tag config JSON (report only; default: ~/.config/agentaudit/clients.json)

If no paths are given, scans ~/.claude/projects/**/*.jsonl.
`;

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: "",
    paths: [],
    format: "text",
    noColor: false,
    minSeverity: "info",
    groupBy: "session",
    topSessions: 10,
    help: false,
    version: false,
  };

  const rest = argv.slice(2);
  if (!rest.length) {
    out.help = true;
    return out;
  }

  const first = rest[0];
  if (first.startsWith("-")) {
    // Allow `agentaudit --help` with no command.
    out.command = "audit";
  } else {
    out.command = first;
    rest.shift();
  }

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    switch (a) {
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--version":
      case "-v":
        out.version = true;
        break;
      case "--json":
        out.format = "json";
        break;
      case "--csv":
        out.format = "csv";
        break;
      case "--format": {
        const v = rest[++i];
        if (v !== "text" && v !== "json" && v !== "csv") {
          throw new Error("--format must be 'text', 'json', or 'csv'");
        }
        out.format = v;
        break;
      }
      case "--no-color":
        out.noColor = true;
        break;
      case "--min": {
        const v = rest[++i];
        if (!v) throw new Error("--min requires a value");
        if (!["info", "low", "medium", "high", "critical"].includes(v)) {
          throw new Error(`invalid --min: ${v}`);
        }
        out.minSeverity = v as Severity;
        break;
      }
      case "--group-by": {
        const v = rest[++i];
        if (v !== "session" && v !== "rule") {
          throw new Error("--group-by must be 'session' or 'rule'");
        }
        out.groupBy = v;
        break;
      }
      case "--top": {
        const v = rest[++i];
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1) {
          throw new Error("--top requires a positive integer");
        }
        out.topSessions = Math.floor(n);
        break;
      }
      case "--since": {
        const v = rest[++i];
        if (!v) throw new Error("--since requires a value");
        out.since = parseSince(v);
        break;
      }
      case "--tag-config": {
        const v = rest[++i];
        if (!v) throw new Error("--tag-config requires a path");
        out.tagConfig = v;
        break;
      }
      default:
        if (a.startsWith("-")) throw new Error(`unknown option: ${a}`);
        out.paths.push(a);
    }
  }

  return out;
}

async function runAudit(args: ParsedArgs): Promise<number> {
  const paths = args.paths.length ? args.paths : await discoverSessions();

  if (!paths.length) {
    process.stderr.write(
      "No session files found. Pass paths explicitly or ensure ~/.claude/projects exists.\n",
    );
    return 2;
  }

  let result = await scanPaths(paths, { rules: DEFAULT_RULES });

  if (args.since) {
    result = filterScanResultBySince(result, args.since);
  }

  if (args.format === "csv") {
    throw new Error("--csv is not supported for audit; use --json for machine-readable output");
  }
  if (args.format === "json") {
    process.stdout.write(`${renderJson(result)}\n`);
  } else {
    process.stdout.write(
      `${renderText(result, {
        color: !args.noColor && (process.stdout.isTTY ?? false),
        minSeverity: args.minSeverity,
        groupBy: args.groupBy,
      })}\n`,
    );
  }

  // Exit code mirrors highest severity found — useful for CI / hooks.
  const severities = new Set(result.findings.map((f) => f.severity));
  if (severities.has("critical")) return 30;
  if (severities.has("high")) return 20;
  if (severities.has("medium")) return 10;
  return 0;
}

async function runReport(args: ParsedArgs): Promise<number> {
  const paths = args.paths.length ? args.paths : await discoverSessions();
  if (!paths.length) {
    process.stderr.write(
      "No session files found. Pass paths explicitly or ensure ~/.claude/projects exists.\n",
    );
    return 2;
  }
  const tagger = await buildTagger(args.tagConfig);
  let report = await analyzePaths(paths, { tagger });
  if (args.since) {
    report = filterUsageReportBySince(report, args.since);
  }
  switch (args.format) {
    case "json":
      process.stdout.write(`${renderUsageJson(report)}\n`);
      break;
    case "csv":
      process.stdout.write(renderUsageCsv(report));
      break;
    default:
      process.stdout.write(`${renderUsageText(report, { topSessions: args.topSessions })}\n`);
  }
  return 0;
}

async function buildTagger(explicitPath: string | undefined) {
  // Explicit path: fail loudly if missing / invalid. Default path: tolerate absence.
  if (explicitPath) {
    const cfg = await loadTagConfig(explicitPath);
    if (!cfg) throw new Error(`--tag-config: file not found: ${explicitPath}`);
    return compileTagger(cfg);
  }
  const cfg = await loadTagConfig(defaultTagConfigPath());
  return cfg ? compileTagger(cfg) : noopTagger;
}

function listRules(): number {
  const w = process.stdout;
  for (const r of DEFAULT_RULES) {
    w.write(`${r.id}  [${r.severity}]\n  ${r.title}\n  ${r.description}\n\n`);
  }
  return 0;
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    process.exit(64);
  }

  if (args.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (args.version) {
    // Kept simple — avoids needing to read package.json at runtime.
    process.stdout.write("sessionguard 0.3.1\n");
    process.exit(0);
  }

  let code = 0;
  switch (args.command) {
    case "audit":
      code = await runAudit(args);
      break;
    case "report":
      code = await runReport(args);
      break;
    case "rules":
      code = listRules();
      break;
    default:
      process.stderr.write(`unknown command: ${args.command}\n\n${USAGE}`);
      code = 64;
  }
  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(
    `sessionguard: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
