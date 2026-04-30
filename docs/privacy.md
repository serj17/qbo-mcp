---
title: Privacy Policy — qbo-mcp
---

# Privacy Policy

*Last updated: 2026-04-30*

`qbo-mcp` is a personal-use, open-source Model Context Protocol (MCP) server that lets a single individual query their own QuickBooks Online data through Claude AI on their own device. This policy describes how data is handled.

## Who maintains this

`qbo-mcp` is maintained by Serj Levesque as a personal open-source project. Contact: [serjlevesque@gmail.com](mailto:serjlevesque@gmail.com), or via [GitHub Issues](https://github.com/serj17/qbo-mcp/issues).

## What data is accessed

When you authorize `qbo-mcp` against your QuickBooks Online company, the software can **read** your accounting data — invoices, bills, customers, vendors, accounts, transactions, reports (P&L, balance sheet, A/R aging, etc.), and attachments — using Intuit's standard OAuth 2.0 flow with the `com.intuit.quickbooks.accounting` scope.

The software exposes **no write tools**: it cannot create, modify, or delete any QuickBooks data. This restriction is enforced in code, not just by convention.

## How the data is used

Data fetched from QuickBooks Online is passed to Claude AI as conversation context so Claude can answer your questions about it. Claude's handling of that data is governed by [Anthropic's Privacy Policy](https://www.anthropic.com/legal/privacy).

## What is stored locally on your device

- **OAuth access and refresh tokens** at your OS-appropriate config directory (`%APPDATA%\qbo-mcp` on Windows, `~/Library/Application Support/qbo-mcp` on macOS, `~/.config/qbo-mcp` on Linux). Tokens never leave your device.
- **Structured log file** at the same config dir. Logs every tool call with redaction for token-shaped values.
- **Cached attachments** (PDFs and images you've asked Claude to read) at the same config dir, with size-bounded LRU eviction.

Nothing is uploaded, sent to telemetry, or shared with the maintainer or any third party.

## What is sent to Anthropic

When you use Claude AI with `qbo-mcp`, the QuickBooks data that Claude reads to answer your question becomes part of your Claude conversation. That conversation is governed by Anthropic's privacy practices, not this project. The `qbo-mcp` server itself never sends data to Anthropic — Claude's client does, on your behalf, as part of normal Claude usage.

## Sharing

The maintainer does not collect, receive, or have access to any user data. There is no analytics, no telemetry, no error reporting, and no shared backend service. Each install runs entirely on the user's own device.

## Retention and deletion

You control all data. To delete:

- **Local tokens, logs, and attachment cache:** delete the config directory listed above.
- **OAuth grant on Intuit's side:** revoke at [intuit.com/account](https://accounts.intuit.com/) → Apps & Subscriptions → "Revoke Access" for the qbo-mcp app, or use the planned `npx qbo-mcp revoke` CLI command (issue [#19](https://github.com/serj17/qbo-mcp/issues/19)).

## Children

`qbo-mcp` is not intended for or directed at children under 13 and does not knowingly collect any data from them.

## Changes

Material changes to this policy will be reflected by updating the date at the top and via the project's CHANGELOG.

## Contact

Questions: [serjlevesque@gmail.com](mailto:serjlevesque@gmail.com) or [github.com/serj17/qbo-mcp/issues](https://github.com/serj17/qbo-mcp/issues).
