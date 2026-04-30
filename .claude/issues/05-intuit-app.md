## Parent

#1

## What to build

**HITL** — register an Intuit Developer app and capture the credentials needed for OAuth. No code in this issue.

This is a prerequisite for #6 (auth-flow). It can happen in parallel with all the AFK code work but must be complete before `auth` can be tested against real Intuit.

## Acceptance criteria

- [x] Intuit Developer account exists at https://developer.intuit.com
- [x] A new app is created under "QuickBooks Online and Payments"
- [x] App's **Development** keys captured: `client_id` and `client_secret` (for sandbox use)
- [ ] App's **Production** keys captured: `client_id` and `client_secret` (for production use; production access may require Intuit's review process — submit and note ETA) — **deferred to #17 (production promotion)**
- [x] **Redirect URI** `http://localhost:8080/callback` registered in the app's OAuth settings (Development section; Production section will be configured when production keys are issued under #17)
- [x] **Scope** `com.intuit.quickbooks.accounting` enabled
- [x] Sandbox company exists and its `realm_id` is captured (visible in the developer dashboard once you connect the sandbox)
- [x] Credentials stored somewhere safe (1Password / env vars) — they will go into `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` env vars or the config file once the auth flow is built

## Blocked by

None — can start immediately. Independent of all code work.
