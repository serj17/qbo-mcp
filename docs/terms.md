---
title: Terms of Service — qbo-mcp
---

# Terms of Service

*Last updated: 2026-04-30*

These terms govern use of `qbo-mcp`, a personal-use open-source MCP server for QuickBooks Online. By installing or using `qbo-mcp`, you agree to these terms.

## Provider

`qbo-mcp` is provided by Serj Levesque as an individual open-source maintainer, not as a business. Contact: [serjlevesque@gmail.com](mailto:serjlevesque@gmail.com).

## License

The source code is released under the MIT License (see [LICENSE](https://github.com/serj17/qbo-mcp/blob/main/LICENSE) in the repository). You may use, copy, modify, and redistribute the software under those terms.

## Intended use

`qbo-mcp` is intended for individuals to query **their own** QuickBooks Online data through Claude AI on their own devices. Each install is single-tenant: it operates against one Intuit OAuth grant per machine and stores no data centrally.

## Read-only by design

`qbo-mcp` exposes **no write tools** to Claude. The MCP server cannot create, modify, or delete QuickBooks data, even though the OAuth scope it requests technically permits writes. This restriction is enforced in code (the absence of write-tool implementations).

You are nonetheless responsible for what you ask Claude to do and for the queries Claude makes against your QuickBooks data on your behalf.

## Your responsibilities

By using `qbo-mcp` you agree that:

- You are authorized to access the QuickBooks Online company you connect.
- You are responsible for your own OAuth credentials, tokens, and the contents of your `tokens.json` file. Do not commit them to version control or share them.
- You comply with [Intuit's Developer Terms](https://developer.intuit.com/app/developer/qbo/docs/develop/legal-terms) for your use of the QuickBooks Online API.
- You comply with [Anthropic's Usage Policies](https://www.anthropic.com/legal/aup) for your use of Claude AI.

## No warranty

The software is provided **"as is"**, without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, accuracy, or non-infringement. The maintainer makes no guarantees about availability, correctness, or fitness for any business or accounting purpose. Decisions you make based on Claude's interpretation of your QuickBooks data are your own.

## Limitation of liability

To the maximum extent permitted by law, in no event shall the maintainer be liable for any direct, indirect, incidental, special, consequential, or exemplary damages arising out of or in connection with the use of `qbo-mcp`, even if advised of the possibility of such damages.

## No support obligation

`qbo-mcp` is provided on a best-effort basis. There is no service-level agreement, no guaranteed response time, and no obligation to fix bugs, add features, or maintain compatibility with future QuickBooks Online API changes. Issues and pull requests on [GitHub](https://github.com/serj17/qbo-mcp/issues) are welcome but reviewed on the maintainer's own schedule.

## Termination

You may stop using `qbo-mcp` at any time by deleting the local installation and revoking the OAuth grant on Intuit's side (see the [Privacy Policy](privacy.html) for instructions).

## Changes

Material changes to these terms will be reflected by updating the date at the top and via the project's CHANGELOG. Continued use after changes constitutes acceptance.

## Governing law

These terms are governed by the laws of the jurisdiction in which the maintainer resides, without regard to conflict-of-law principles.
