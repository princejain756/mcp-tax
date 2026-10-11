#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { encode } from "gpt-tokenizer";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type ServerSpec = { command: string; args?: string[]; env?: Record<string, string> };
type ServerResult = {
  name: string;
  source: string;
  tokens: number;
  tools: number;
  prompts: number;
  resources: number;
  top: string;
  error?: string;
};

const CONFIG_PATHS: Array<[string, string]> = [
  ["claude-desktop", join(homedir(), "Library/Application Support/Claude/claude_desktop_config.json")],
  ["claude-code", join(homedir(), ".claude.json")],
  ["cursor", join(homedir(), ".cursor/mcp.json")],
  ["project", join(process.cwd(), ".mcp.json")],
  ["vscode", join(process.cwd(), ".vscode/mcp.json")],
];

const CONTEXT_WINDOWS = [200_000, 128_000, 32_000];
const SERVER_TIMEOUT_MS = 15_000;

function tokens(s: string): number {
  return encode(s).length;
}

function discoverServers(): Array<{ name: string; source: string; spec: ServerSpec }> {
  const found: Array<{ name: string; source: string; spec: ServerSpec }> = [];
  for (const [source, path] of CONFIG_PATHS) {
    if (!existsSync(path)) continue;
    try {
      const cfg = JSON.parse(readFileSync(path, "utf8"));
      const servers = cfg.mcpServers ?? cfg.servers ?? {};
      for (const [name, spec] of Object.entries<any>(servers)) {
        if (spec?.command) found.push({ name, source, spec });
      }
    } catch {
      console.error(`warning: could not parse ${path}`);
    }
  }
  return found;
}

// Serialize the same payload clients send to the model: name + description + schema.
function describe(list: Array<{ name: string; description?: string; inputSchema?: unknown }>): string {
  return list.map((t) => `${t.name}\n${t.description ?? ""}\n${JSON.stringify(t.inputSchema ?? {})}`).join("\n");
}

async function measure(name: string, source: string, spec: ServerSpec): Promise<ServerResult> {
  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args ?? [],
    env: { ...process.env, ...(spec.env ?? {}) } as Record<string, string>,
    stderr: "ignore",
  });
  const client = new Client({ name: "mcp-tax", version: "1.0.0" });
  try {
    await Promise.race([
      client.connect(transport),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), SERVER_TIMEOUT_MS)),
    ]);
    const [tools, prompts, resources] = await Promise.allSettled([
      client.listTools(),
      client.listPrompts(),
      client.listResources(),
    ]);
    const toolList = tools.status === "fulfilled" ? tools.value.tools : [];
    const promptList = prompts.status === "fulfilled" ? prompts.value.prompts : [];
    const resourceList = resources.status === "fulfilled" ? resources.value.resources : [];

    const toolText = describe(toolList);
    const promptText = promptList.map((p) => `${p.name}\n${p.description ?? ""}`).join("\n");
    const resourceText = resourceList.map((r) => `${r.name}\n${r.description ?? ""}`).join("\n");
    const total = tokens(toolText) + tokens(promptText) + tokens(resourceText);

    // biggest single tool description
    let top = "";
    let topN = 0;
    for (const t of toolList) {
      const n = tokens(describe([t]));
      if (n > topN) { topN = n; top = `${t.name} (${n})`; }
    }
    return { name, source, tokens: total, tools: toolList.length, prompts: promptList.length, resources: resourceList.length, top };
  } catch (e) {
    return { name, source, tokens: 0, tools: 0, prompts: 0, resources: 0, top: "", error: String(e).slice(0, 80) };
  } finally {
    try { await client.close(); } catch {}
    try { await transport.close(); } catch {}
  }
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

async function main() {
  const json = process.argv.includes("--json");
  const servers = discoverServers();
  if (servers.length === 0) {
    console.log("No MCP servers found in Claude Desktop, Claude Code, Cursor, or .mcp.json.");
    return;
  }
  if (!json) console.log(`Measuring ${servers.length} MCP server${servers.length === 1 ? "" : "s"}…\n`);

  const results: ServerResult[] = [];
  for (const s of servers) results.push(await measure(s.name, s.source, s.spec));

  const ok = results.filter((r) => !r.error).sort((a, b) => b.tokens - a.tokens);
  const failed = results.filter((r) => r.error);
  const total = ok.reduce((a, r) => a + r.tokens, 0);

  if (json) {
    console.log(JSON.stringify({ total, servers: ok, failed }, null, 2));
    return;
  }

  const w = Math.max(...ok.map((r) => r.name.length), 6);
  console.log(`${"SERVER".padEnd(w)}  TOOLS  ~TOKENS`);
  console.log(`${"-".repeat(w)}  -----  -------`);
  for (const r of ok) console.log(`${r.name.padEnd(w)}  ${String(r.tools).padEnd(5)}  ${fmt(r.tokens)}`);
  for (const r of failed) console.log(`${r.name.padEnd(w)}  (failed: ${r.error})`);

  console.log(`\nTotal: ~${fmt(total)} tokens before you type a word.`);
  for (const c of CONTEXT_WINDOWS) {
    console.log(`  ${(100 * total / c).toFixed(1)}% of a ${fmt(c)} context window`);
  }
  if (ok.length && ok[0].top) console.log(`\nBiggest tool schema: ${ok[0].top} tokens`);
  console.log(`\n(Token counts use o200k — an approximation; your client's tokenizer may differ.)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
