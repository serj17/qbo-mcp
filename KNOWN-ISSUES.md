# Known issues

Operational gotchas hit in the field. Append new entries when they
come up rather than letting them rot in chat history.

## UTF-8 vs Windows console code page (mojibake)

**Symptom:** Reports against a non-English QBO realm render with
mangled accents in PowerShell or `cmd.exe` — `Total des revenus`
shows up as `Total des revenusâ` or `coÃ»t des marchandises vendues`,
and month abbreviations like `févr. 2026` become `fÃ©vr. 2026`.

**Cause:** The QBO Reports API returns labels localized to the
company's locale (French, in this case). The server emits UTF-8
correctly, but Windows consoles default to code page 1252
(Windows-1252) and reinterpret each two-byte UTF-8 sequence as two
Latin-1 characters. The data is correct on the wire and in the log
file; only the display is wrong.

**Fix:** Add to your PowerShell profile (`$PROFILE`):

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
```

After restarting the shell, accents render correctly.

**Why this isn't caught earlier:** Intuit's canned sandbox uses
English labels with no accents, so the mojibake never appears in
sandbox integration tests.

## Quebec / non-US tax structure (multi-line `TxnTaxDetail.TaxLine`)

**Symptom:** Code that assumes `Invoice.TxnTaxDetail.TaxLine` is a
single-element array (the US sandbox shape, with one `SalesTax`
line) breaks when run against a Quebec realm — it returns two lines
per invoice (`TPS 5%` + `TVQ 9.975%`).

**Cause:** Quebec — and most non-US locales — use multiple
sales-tax lines. The QBO API returns whatever the realm is
configured for; the shape is a variable-length array.

**Fix:** Treat `TxnTaxDetail.TaxLine` as `TaxLine[]` everywhere.
The qbo-mcp server passes the Invoice JSON through unmodified, so
this falls on consumers (Claude, downstream parsers) to handle.

**Pattern note:** the same applies to other non-US locales (UK
VAT, EU multi-rate VAT, Canadian GST/PST split).

## libuv shutdown assertion on `doctor` exit (Node 24, Windows)

**Symptom:** Running `node dist/index.js doctor` (or
`npx qbo-mcp doctor`) prints its report and exit code correctly,
then emits a single line on stderr right before the process exits:

```
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
```

**Cause:** A libuv teardown assertion specific to Node 24 on
Windows. Surfaces only on processes that exit cleanly — the
long-running MCP server (which does not exit) is unaffected.

**Impact:** Cosmetic. The report is correct, the exit code is
correct, downstream tooling that reads exit status sees `0` (or `1`
on a real failure) regardless. Safe to ignore.

**Fix:** None on our side; needs to be addressed in libuv / Node
upstream. Track via `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` in upstream issues if it
becomes load-bearing.

## Tested on

Append a new row to this table whenever a fresh device install
passes the doctor / smoke check.

| Date       | OS                        | Node     | QBO env    | Result |
|------------|---------------------------|----------|------------|--------|
| 2026-05-07 | Windows 11 Pro 10.0.26200 | v24.14.0 | production | All 5 #17 acceptance criteria passed against real Quebec books (CAD, IFRS, TPS/TVQ). Read-only confirmed. |
