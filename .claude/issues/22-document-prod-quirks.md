## Parent

#17

## What to build

Capture the prod-only quirks discovered during the #17 smoke test (run on
2026-05-07 against the real Quebec construction-company books) into a
`KNOWN-ISSUES.md` at the repo root. The smoke test surfaced three things that
sandbox testing cannot reproduce; they need to be written down so future-you
or a fresh-device user is not surprised.

`KNOWN-ISSUES.md` should be the home for ongoing operational gotchas — append
new entries here when they come up rather than letting them rot in chat
history.

### Findings to document

1. **Production-locale data is UTF-8; Windows consoles default to
   Windows-1252.** The QBO Reports API returns localized labels in the
   company's locale (French, in this case: `Total des revenus`,
   `coût des marchandises vendues`, `févr. 2026`). The server emits UTF-8
   correctly, but the default PowerShell / `cmd.exe` console code page is
   Windows-1252, so accented characters render as mojibake (`fÃ©vr.`,
   `coÃ»t`) when piped into a terminal. The data is correct; only the
   display is wrong. Recommend a one-time PowerShell profile fix:

   ```powershell
   [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
   $OutputEncoding = [System.Text.Encoding]::UTF8
   ```

   Sandbox tests don't catch this because Intuit's canned sandbox uses
   English labels with no accents.

2. **Quebec tax structure (TPS / TVQ) instead of single `SalesTax` line.**
   Real Quebec books return two tax lines per invoice (`TPS 5%` +
   `TVQ 9.975%`) where the US sandbox returns a single `SalesTax`. The
   Invoice JSON is passed through unmodified, so consumers parsing
   `TxnTaxDetail.TaxLine[]` need to handle a variable-length array, not a
   single entry. Same pattern applies to other non-US locales.

3. **libuv shutdown assertion on `doctor` exit (Node 24 + Windows).** After
   `node dist/index.js doctor` prints its report, the process emits:

   ```
   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
   ```

   before exiting. The report and exit code are correct; this is a libuv
   teardown assertion specific to Node 24 on Windows. Doesn't affect the
   long-running MCP server (which doesn't exit). Cosmetic only.

### Tested-on entry

Also start a "Tested on" table at the bottom of `KNOWN-ISSUES.md` so future
fresh-device installs add a row. Seed it with this row:

| Date       | OS                        | Node    | QBO env    | Result |
|------------|---------------------------|---------|------------|--------|
| 2026-05-07 | Windows 11 Pro 10.0.26200 | v24.14.0 | production | All 5 #17 acceptance criteria passed against real Quebec books (CAD, IFRS, TPS/TVQ). Read-only confirmed. |

## Acceptance criteria

- [ ] `KNOWN-ISSUES.md` created at repo root
- [ ] Section for the UTF-8 / Windows console mojibake issue, including the PowerShell-profile workaround
- [ ] Section for the TPS/TVQ multi-line tax structure with a note for non-US locales generally
- [ ] Section for the libuv shutdown assertion on `doctor` exit
- [ ] "Tested on" table at the bottom seeded with the 2026-05-07 row above
- [ ] No code changes — this is a documentation-only issue

## Blocked by

None.
