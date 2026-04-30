import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { ZodRawShape } from "zod";
import type { QboClient, QboError, Result } from "../qbo-client/index.js";

export interface ToolDeps {
  qbo: QboClient;
  logger: Logger;
}

export interface ToolDefinition<Input> {
  name: string;
  description: string;
  /** Zod field shape (object form) used by McpServer.tool. */
  schema: ZodRawShape;
  /**
   * Handler returns a Result. On ok, the value is JSON-encoded into the tool
   * response. On error, the QboError is mapped into the MCP isError shape
   * with a remediation message and structured _meta for Claude to reason
   * about.
   */
  handler: (input: Input, deps: ToolDeps) => Promise<Result<unknown, QboError>>;
}

interface McpToolResultContent {
  type: "text";
  text: string;
}
interface McpToolResult {
  [key: string]: unknown;
  content: McpToolResultContent[];
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

/**
 * Register a tool against the MCP server with three layers of automatic
 * scaffolding around the handler:
 *
 *   1. Per-call structured logging — the tool name, input args, duration,
 *      and outcome land in the log file so Claude can call get_recent_logs
 *      and see what happened.
 *   2. QboError -> MCP error mapping — the error message becomes the user-
 *      facing text, the code lands in _meta so Claude can branch on it.
 *   3. Programmer-error capture — if the handler throws (not returning a
 *      Result), we wrap it in a generic error rather than crashing the
 *      server process. One bad tool can't take down the others.
 */
export function defineTool<Input>(
  server: McpServer,
  deps: ToolDeps,
  definition: ToolDefinition<Input>,
): void {
  server.tool(
    definition.name,
    definition.description,
    definition.schema,
    async (rawInput: unknown): Promise<McpToolResult> => {
      const start = Date.now();
      const input = rawInput as Input;
      deps.logger.info(
        { tool: definition.name, args: input, event: "tool_call_start" },
        `tool ${definition.name} start`,
      );
      try {
        const result = await definition.handler(input, deps);
        const duration_ms = Date.now() - start;
        if (!result.ok) {
          deps.logger.error(
            {
              tool: definition.name,
              code: result.error.code,
              status: result.error.qbo_status,
              msg: result.error.message,
              duration_ms,
              event: "tool_call_error",
            },
            `tool ${definition.name} error`,
          );
          return mapQboErrorToToolResult(result.error);
        }
        deps.logger.info(
          { tool: definition.name, duration_ms, event: "tool_call_ok" },
          `tool ${definition.name} ok`,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result.value, null, 2) }],
        };
      } catch (err) {
        const duration_ms = Date.now() - start;
        const e = err as Error;
        deps.logger.error(
          {
            tool: definition.name,
            err: e.message,
            stack: e.stack,
            duration_ms,
            event: "tool_call_threw",
          },
          `tool ${definition.name} threw`,
        );
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `tool ${definition.name} crashed: ${e.message}. Call get_recent_logs to inspect the stack trace.`,
            },
          ],
          _meta: { code: "TOOL_HANDLER_ERROR" },
        };
      }
    },
  );
}

export function mapQboErrorToToolResult(error: QboError): McpToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: error.message }],
    _meta: {
      code: error.code,
      retryable: error.retryable,
      ...(error.qbo_status !== undefined ? { qbo_status: error.qbo_status } : {}),
      ...(error.retry_after_seconds !== undefined ? { retry_after_seconds: error.retry_after_seconds } : {}),
    },
  };
}
