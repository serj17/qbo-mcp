/**
 * End-to-end smoke test: spawn the published bin, talk to it via the real
 * MCP stdio transport, list its tools, and call list_invoices. Verifies
 * everything from JSON-RPC encoding through tool-registry through fetch
 * to QBO and back.
 *
 * Run: npx tsx scripts/smoke-test.mts
 *
 * Reads .env automatically via dotenv (server side does the same).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const binPath = resolve(repoRoot, "dist/index.js");

async function main() {
  console.log(`spawning: node ${binPath}\n`);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binPath],
    cwd: repoRoot,
    stderr: "inherit",
  });

  const client = new Client({ name: "qbo-mcp-smoke", version: "0.0.1" });
  await client.connect(transport);
  console.log("connected.\n");

  const tools = await client.listTools();
  console.log("tools registered:");
  for (const t of tools.tools) {
    console.log(`  - ${t.name}`);
  }
  console.log();

  console.log("calling list_invoices({ limit: 3 })...\n");
  const result = await client.callTool({
    name: "list_invoices",
    arguments: { limit: 3 },
  });

  if (result.isError) {
    console.error("TOOL RETURNED ERROR:");
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    const content = (result.content as Array<{ type: string; text: string }>) ?? [];
    const first = content[0];
    if (first?.type === "text") {
      const parsed = JSON.parse(first.text) as {
        items: Array<{ Id: string; DocNumber?: string; TxnDate?: string; TotalAmt?: number; Balance?: number }>;
        page_info: { total_count?: number; returned_count: number; has_more: boolean; next_cursor: string | null };
      };
      console.log(`returned ${parsed.items.length} invoices (total in sandbox: ${parsed.page_info.total_count ?? "?"})\n`);
      for (const inv of parsed.items) {
        console.log(`  Id=${inv.Id} DocNumber=${inv.DocNumber ?? "-"} TxnDate=${inv.TxnDate ?? "-"} TotalAmt=${inv.TotalAmt ?? "-"} Balance=${inv.Balance ?? "-"}`);
      }
      console.log(`\npage_info: ${JSON.stringify(parsed.page_info)}`);
    } else {
      console.log("unexpected content shape:", JSON.stringify(result, null, 2));
    }
  }

  console.log("\ncalling list_invoices({ count_only: true })...");
  const countResult = await client.callTool({
    name: "list_invoices",
    arguments: { count_only: true },
  });
  if (!countResult.isError) {
    const content = (countResult.content as Array<{ type: string; text: string }>) ?? [];
    const parsed = JSON.parse(content[0]!.text) as { page_info: { total_count: number } };
    console.log(`total invoices in sandbox: ${parsed.page_info.total_count}`);
  }

  await client.close();
  console.log("\nsmoke test ok.");
}

main().catch((err) => {
  console.error("\nsmoke test FAILED:", err);
  process.exitCode = 1;
});
