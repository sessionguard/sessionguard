/**
 * Per-client tagging from a small JSON config. Each session's `cwd` is
 * tested against a list of patterns; the first match yields a tag name
 * that gets attached to the session and rolled up in reports.
 *
 * Patterns are literal substrings unless wrapped in `/.../` (then parsed
 * as a regex).
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ClientRule {
  /** Literal substring to match against session cwd, or `/regex/` wrapped form. */
  pattern: string;
  /** Tag applied when the rule matches. */
  name: string;
}

export interface TagConfig {
  clients?: ClientRule[];
}

export interface SessionLike {
  path: string;
  cwd?: string;
}

export type Tagger = (session: SessionLike) => string | undefined;

export const noopTagger: Tagger = () => undefined;

interface CompiledRule {
  test: (cwd: string) => boolean;
  name: string;
}

export function compileTagger(config: TagConfig): Tagger {
  const rules: CompiledRule[] = [];
  for (const rule of config.clients ?? []) {
    if (typeof rule.pattern !== "string" || typeof rule.name !== "string") {
      throw new Error("tagger: each client rule needs string `pattern` and `name`");
    }
    rules.push(compileRule(rule));
  }
  if (!rules.length) return noopTagger;
  return (session) => {
    if (!session.cwd) return undefined;
    for (const r of rules) if (r.test(session.cwd)) return r.name;
    return undefined;
  };
}

function compileRule(rule: ClientRule): CompiledRule {
  const { pattern, name } = rule;
  if (pattern.length > 2 && pattern.startsWith("/") && pattern.endsWith("/")) {
    const body = pattern.slice(1, -1);
    try {
      const re = new RegExp(body);
      return { test: (cwd) => re.test(cwd), name };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`tagger: invalid regex in rule "${pattern}": ${reason}`);
    }
  }
  return { test: (cwd) => cwd.includes(pattern), name };
}

/**
 * Read and validate a tag config. Returns undefined if the file doesn't
 * exist (caller can fall back to a no-op tagger).
 */
export async function loadTagConfig(path: string): Promise<TagConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw new Error(`tag config: cannot read ${path}: ${err instanceof Error ? err.message : err}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `tag config: ${path} is not valid JSON: ${err instanceof Error ? err.message : err}`,
    );
  }
  return validateTagConfig(parsed, path);
}

function validateTagConfig(value: unknown, path: string): TagConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`tag config: ${path} must be a JSON object`);
  }
  const obj = value as Record<string, unknown>;
  if (obj.clients !== undefined && !Array.isArray(obj.clients)) {
    throw new Error(`tag config: ${path} "clients" must be an array`);
  }
  return obj as TagConfig;
}

export function defaultTagConfigPath(): string {
  return join(homedir(), ".config", "sessionguard", "clients.json");
}
