# sessionguard

[![CI](https://github.com/sessionguard/sessionguard/actions/workflows/ci.yml/badge.svg)](https://github.com/sessionguard/sessionguard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node: ≥22](https://img.shields.io/badge/node-%E2%89%A522-green.svg)](./package.json)

**See what your AI coding agent actually did.** Local audit of Claude Code session transcripts: leaked secrets, risky shell commands, unsafe file edits, hook bypasses — plus per-project / per-model token usage. Runs entirely on your machine, nothing uploaded.

> **Today:** Claude Code only. Cursor and Windsurf session-format adapters are on the roadmap but not yet shipped — see [Roadmap](#roadmap).
> **Released:** v0.3.0 on npm with signed provenance via OIDC trusted publishing. Verify with `npm audit signatures`.
> **Status:** detection logic and per-project / per-model token reporting are shipped; release pipeline and signed provenance are shipped; a red-team golden set and drift monitoring are still in flight. Full posture in [Governance](#governance).

## Why

AI coding agents happily run `curl | sudo bash`, write to `~/.ssh/authorized_keys`, or commit with `--no-verify` when things get in their way. The transcripts that record this live on your disk — and often contain `.env` contents, API keys fed to the model, or tool outputs that captured credentials. Nobody reads them after the fact.

`sessionguard` is a grep with manners for those transcripts. Run it weekly (or in a hook) and get a punch list of things worth a second look.

## Install

```sh
# From npm (recommended)
npm install -g @sessionguard/cli
sessionguard --version

# Or from source
git clone https://github.com/sessionguard/sessionguard.git
cd sessionguard
npm ci && npm run build
npm link            # puts `sessionguard` on PATH
```

Requires Node 22+. The package is published scoped as `@sessionguard/cli`; the CLI binary is `sessionguard`.

### Verifying the release

Every release from v0.3.0 onwards is published from GitHub Actions via npm OIDC trusted publishing, with a signed provenance attestation linking the tarball to a specific commit and workflow run. To verify what you just installed:

```sh
npm audit signatures
```

Provenance records for each version are also visible on <https://www.npmjs.com/package/@sessionguard/cli>.

## Usage

```sh
sessionguard audit                          # scan ~/.claude/projects/**/*.jsonl
sessionguard audit path/to/session.jsonl    # scan specific files
sessionguard audit --min high               # only show high/critical
sessionguard audit --json                   # machine-readable output
sessionguard audit --group-by rule          # group by rule instead of session

sessionguard report                         # per-project / per-model token rollup
sessionguard report --top 5                 # top N sessions by output tokens
sessionguard report --since 7d              # only sessions active in the last 7 days
sessionguard report --since 2026-04-01      # or an ISO date
sessionguard report --tag-config clients.json  # group by client tag (see Billing below)
sessionguard report --json                  # full UsageReport as JSON
sessionguard report --csv                   # one row per session × model, invoice-ready

sessionguard rules                          # list all audit checks
```

Exit code mirrors the highest severity found: `30` (critical), `20` (high), `10` (medium), `0` otherwise. Useful in a shell hook or cron:

```sh
sessionguard audit --min high || notify-send "Claude Code session findings"
```

## What it checks (v0.1)

| Rule | Severity | What it catches |
|------|----------|-----------------|
| `secrets.in-user-prompt` | critical | API keys, tokens, private keys pasted by the human into a prompt |
| `secrets.in-tool-result` | high | Same patterns appearing in tool output fed back to the model |
| `bash.risky-command` | critical–low | `rm -rf /`, `curl \| sh`, `dd of=/dev/sdX`, world-writable chmod, firewall flush, `git push --force`, etc. |
| `fs.sensitive-path-write` | critical–medium | `Write`/`Edit` targeting `~/.ssh`, `~/.aws`, `~/.gnupg`, `.env`, `/etc/sudoers`, shell rc files, systemd units… |
| `git.hook-bypass` | medium | `git commit --no-verify`, `-c commit.gpgsign=false`, `SKIP=…`; also flags user prompts explicitly asking for the bypass |

Patterns are deliberately conservative. False positives erode trust; a false *negative* is a known limit we'd rather improve with a pull request than paper over.

## Privacy

Everything runs locally. `sessionguard` reads files under `~/.claude/projects/`, processes them in memory, and prints to stdout. No network, no telemetry, no config to opt out of.

Findings may contain excerpts of prompts or command strings — don't paste `--json` output anywhere public without reviewing it first.

## Limitations (read these before trusting it)

- **Pattern-based, not semantic.** It flags `curl | sh`, not "any command that downloads and executes remote code." Your adversary is distracted engineers, not a determined attacker.
- **Single-session scope.** It doesn't correlate across sessions or detect slow exfiltration.
- **Self-matching.** Rules that look for flag strings will match commands whose *data* contains those strings (e.g. `node -e 'const re = /--no-verify/'`). We suppress the common interpreter-eval case; the long tail is a known gap.
- **Transcript fidelity.** We parse Anthropic's Claude Code JSONL format as observed in late April 2026. The schema is private API and can change.

## Billing / per-client reports

If you're a freelancer or consultant using Claude Code across multiple client projects, tag sessions by cwd with a small JSON file:

```json
{
  "clients": [
    { "pattern": "/home/me/clients/acme",  "name": "acme" },
    { "pattern": "/home/me/clients/beta",  "name": "beta" },
    { "pattern": "/personal/",              "name": "personal" }
  ]
}
```

Save as `~/.config/agentaudit/clients.json` (default) or pass `--tag-config path/to/file.json`. Patterns are literal substrings unless wrapped in `/.../` (then parsed as a regex; first match wins).

Then:
- `sessionguard report --since 2026-04-01` → monthly-close token totals by client.
- `sessionguard report --csv > april.csv` → one row per session × model, ready for a pivot table.

`sessionguard` reports token counts, not dollars. Per-session dollar values need current pricing; see the decision log for the reasoning and the planned pricing-file support.

## Roadmap

- Dollar-cost estimation via a dated, sourced `pricing.json` (next up).
- Cursor / Windsurf session format adapters.
- Custom rules via a small plugin interface (rules are plain objects — already pluggable internally).
- HTML report output for weekly review.
- Golden red-team fixture set for Phase V metric #2.

## Governance

Where the project is, what's committed to, and what would make us archive it.

### Status

| Status | What |
|---|---|
| ✅ Shipped | Threat model + scope. Streaming JSONL parser (tolerant of malformed lines, documented in `src/types.ts`). Five rule families: secrets-in-prompt, secrets-in-tool-result, risky-bash, sensitive-path-edit, hook-bypass — 13 bash patterns, 15 sensitive paths, 15 secret patterns. 132 unit tests. Per-project / per-model token usage with CSV export. v0.3.0 published on npm as @sessionguard/cli. CI on every push. |
| 🟡 In flight | Real-session validation against the developer's own corpus (15 sessions / 6883 events as of 2026-06-29). Golden red-team fixture set (planted-secret + risky-command scenarios with known-true labels). Drift monitoring (rule-coverage / FP-rate / scan-time, scheduled weekly against a frozen corpus). |
| ⏳ Not started | Cursor and Windsurf session-format adapters. Pricing-file support to convert tokens to dollar estimates. Custom rules via plugin interface. |

### Outcome metrics

Set early, reviewed before each release.

1. **Precision on real sessions.** At minimum 95% true-positive rate in the `medium+` bucket on the developer's own session history. Current: 2/2 (100%, n=2).
2. **Coverage of planted-secret golden set.** Detects ≥ 80% of a planned red-team fixture set of realistic leak scenarios. Current: **not yet measured** (golden set to be built in Phase V).
3. **Scan performance.** Scans 1,000 events under 1 second on a modern laptop. Current: ~800 events in ~350ms wall-clock (release build).

### Ethical posture

- **Privacy by default.** Local-only. No network. No telemetry. Reads only under `~/.claude/projects/` by default.
- **Transparency.** OSS (MIT). Known gaps listed in the threat model in this repo.
- **Data minimisation.** Output redacts secret values (`ghp_…abcd`) and shows only the matching line for long commands.
- **Non-harm.** We refuse to add: telemetry, content phone-home, surveillance of other users' sessions, or anything that would enable covert monitoring.

### Drift monitoring (planned)

- **Rule coverage drift** — matches per 1k events, tracked weekly against the scanned session corpus.
- **False-positive rate** — tracked against a labelled sample; alert if it exceeds 5%.
- **Schema drift** — alerted if new `type` values appear in session JSONL that we don't recognise (Anthropic's private schema can evolve).
- **Scan-time drift** — alerted if wall-clock-per-event regresses > 2×.

### Decision log

Material decisions are recorded in this repo's decision log (one paragraph per decision, dated). Change history sits alongside it — current release v0.3.0.

### Sunset criteria

Archive this project if any of these become true:

- Anthropic (or the Cursor / Windsurf vendors, once their adapters land) ships a first-party local-audit tool that covers the same surface (secrets, risky shell, sensitive-path writes, hook bypasses) with comparable transparency.
- The session-transcript schemas converge on a stable public format and the rule set becomes a thin wrapper around that — at which point the rules belong upstream, not in a sidecar.
- Maintenance burden of tracking schema drift across three vendors exceeds the value delivered to users (measured against the outcome metrics above).
- The threat model assumption — local-only, single-user box, agent is trusted but its data is not — stops holding for the configurations users actually run.

## License

MIT.
