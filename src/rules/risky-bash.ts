import { getToolUses } from "../extract.js";
import { isInterpreterEval } from "../shell.js";
import { matchingLine } from "../snippet.js";
import type { Finding, Rule, RuleContext, Severity } from "../types.js";

interface BashRisk {
  id: string;
  label: string;
  severity: Severity;
  pattern: RegExp;
}

const RISKS: BashRisk[] = [
  {
    id: "rm-rf-root",
    label: "rm -rf targeting root, home, or a system path",
    severity: "critical",
    pattern:
      /\brm\s+(?:-[a-zA-Z]*(?:rf|fr)[a-zA-Z]*|--recursive[\w\s-]*--force|--force[\w\s-]*--recursive)\s+(?:\/(?:\s|$|\*|[a-zA-Z])|~(?:\/|\s|$)|\$HOME\b|--\s+\/)/,
  },
  {
    id: "curl-pipe-shell",
    label: "curl | sh / wget | sh (unreviewed remote execution)",
    severity: "high",
    pattern: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python3?|node|ruby|perl)\b/,
  },
  {
    id: "git-no-verify",
    label: "git commit/push with --no-verify (bypasses pre-commit hooks)",
    severity: "medium",
    pattern: /\bgit\s+(?:commit|push|merge|rebase)\b[^\n]*--no-verify\b/,
  },
  {
    id: "git-force-push",
    label: "git push --force / -f (history rewrite on remote)",
    severity: "medium",
    pattern: /\bgit\s+push\b[^\n]*(?:--force\b|(?<!-)-f\b)(?![a-zA-Z])/,
  },
  {
    id: "git-reset-hard",
    label: "git reset --hard (discards uncommitted work)",
    severity: "low",
    pattern: /\bgit\s+reset\s+--hard\b/,
  },
  {
    id: "chmod-world-write",
    label: "chmod world-writable",
    severity: "medium",
    pattern: /\bchmod\b[^\n]*(?:\b777\b|\bo\+w\b|\ba\+w\b)/,
  },
  {
    id: "chown-root",
    label: "chown root ownership transfer",
    severity: "low",
    pattern: /\bchown\s+(?:-R\s+)?root\b/,
  },
  {
    id: "disable-selinux",
    label: "setenforce / SELinux or AppArmor disable",
    severity: "high",
    pattern: /\b(?:setenforce\s+0|aa-disable|aa-complain)\b/,
  },
  {
    id: "iptables-flush",
    label: "firewall flush / permissive ALL",
    severity: "high",
    pattern: /\b(?:iptables|nft)\b[^\n]*(?:\s-F\b|\sflush\b|policy\s+ACCEPT)/i,
  },
  {
    id: "sudo-shell",
    label: "interactive sudo shell",
    severity: "medium",
    pattern: /\bsudo\s+(?:-s\b|-i\b|su\b|bash\b|sh\b|zsh\b)/,
  },
  {
    id: "eval-user-input",
    label: "shell eval (arbitrary code execution from string)",
    severity: "medium",
    pattern: /\beval\s+["$]/,
  },
  {
    id: "dd-of-device",
    label: "dd to block device (data destruction risk)",
    severity: "critical",
    pattern: /\bdd\b[^\n]*\bof=\/dev\/(?:sd|nvme|mmcblk|hd|xvd)/,
  },
  {
    id: "gpg-disable",
    label: "git commit with --no-gpg-sign (signature bypass)",
    severity: "low",
    pattern: /\bgit\s+(?:commit|tag)\b[^\n]*--no-gpg-sign\b/,
  },
];

export const riskyBash: Rule = {
  id: "bash.risky-command",
  title: "Risky or destructive shell command executed by agent",
  severity: "high",
  description:
    "Flags shell commands that are irreversible, bypass safety controls, or expand blast radius (rm -rf /, curl|sh, force-push, chmod 777, dd to disk, etc.).",
  check(ctx: RuleContext): Finding[] {
    const uses = getToolUses(ctx.event);
    if (!uses.length) return [];
    const out: Finding[] = [];
    for (const use of uses) {
      if (use.name !== "Bash") continue;
      const cmd = typeof use.input?.command === "string" ? (use.input.command as string) : "";
      if (!cmd) continue;
      if (isInterpreterEval(cmd)) continue;
      const isLocalCurl = /\b(?:curl|wget)\b[^|\n]*(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(cmd);
      for (const risk of RISKS) {
        if (risk.pattern.test(cmd) && !(risk.id === "curl-pipe-shell" && isLocalCurl)) {
          out.push({
            ruleId: `${this.id}.${risk.id}`,
            severity: risk.severity,
            title: risk.label,
            message: `Agent ran a shell command matching "${risk.label}". Review whether this was intended and whether any safety rail was bypassed.`,
            sessionPath: ctx.sessionPath,
            sessionId: ctx.sessionMeta.sessionId,
            eventUuid: typeof ctx.event.uuid === "string" ? ctx.event.uuid : undefined,
            timestamp: ctx.event.timestamp,
            excerpt: matchingLine(cmd, risk.pattern),
            evidence: { riskId: risk.id, toolUseId: use.id },
          });
        }
      }
    }
    return out;
  },
};
