# Web App Layer — Deployment & Guide

A browser UI on top of the existing, already-deployed Finance Lab backend. **Everything under `apps-script/webapp/` is new and additive** — no existing sheet, schema, formula, ID format, or business rule was changed to build it. It calls the same functions the Sheets UI and triggers already use (`createNewClient`, `createTask`, `updateTaskStatus`, `reassignTask`, `createClientRequest`, `createIssue`, `getAllRows`, etc.).

## What's in `apps-script/webapp/`

| File | Purpose |
|---|---|
| `WebAppEntry.gs` | `doGet(e)` — the Web App's single entry point. Checks the visitor against EMPLOYEES (see Access control below) and serves either the app or an access-restricted page. |
| `Index.html` | Page shell: header, nav, content mount point. |
| `Styles.html` | All CSS (included into `Index.html`/`AccessDenied.html` via the standard `<?!= include('webapp/Styles'); ?>` pattern). |
| `AppScript.html` | Client-side JS: hash router (`#control-center`, `#clients`, `#tasks`), a `callServer()` helper wrapping `google.script.run`, and shared formatting/badge helpers each view reuses. |
| `AccessDenied.html` | Shown to anyone who isn't a recognized active employee. |

As of this increment, the 3 nav routes exist and route correctly but show "Coming soon" placeholders — Increments 2-4 wire each one to real data.

## Access control

The deployment is set to **"Execute as: User accessing the web app"** and **"Access: Anyone [with a Google account]"** (`apps-script/appsscript.json`) — that only means a visitor must be signed in with *some* Google account, not that they're authorized. The actual allowlist is `checkWebAppAccess()` in `WebAppEntry.gs`: it looks up the visitor's email in the existing **EMPLOYEES** sheet and only lets them in if there's a row with a matching Email and `Active?` = "Yes". No separate access-control list to maintain — deactivating someone in EMPLOYEES (which you'd already do) also revokes their Web App access.

If your organization is on Google Workspace and you'd rather restrict at the deployment level too (defense in depth), you can tighten `"access"` in `appsscript.json` to `"DOMAIN"` before deploying, or change it in the deployment dialog — either way, the EMPLOYEES check still applies underneath.

## Deploying

1. **Set up `.clasp.json`** (not committed, since it's per-deployment): copy `.clasp.json.example` to `.clasp.json` at the repo root and fill in your existing project's Script ID (Apps Script editor → Project Settings → Script ID — the same project you already ran `setupSpreadsheet()`/`seedSampleData()` in, not a new one).
2. **Push**: `clasp push` from the repo root (rootDir is already set to `apps-script`). This adds the new `webapp/*` files and `appsscript.json` to your existing, live Apps Script project — it does not touch or re-run any existing file.
3. **Deploy as Web App**: in the Apps Script editor, **Deploy → New deployment → Web app**. Confirm "Execute as: User accessing the web app" and "Who has access" per the Access control section above. Deploy, and copy the Web App URL.
4. **Open the URL** while signed in as an email that has an `Active` = Yes row in EMPLOYEES. You should see the shell with working navigation. Signed in as anyone else, you should see the Access Restricted page.

Re-deploying after future `clasp push`es requires either **Deploy → Manage deployments → Edit → new version**, or a fresh deployment — plain `clasp push` alone updates the underlying script but not a *published* web app version.

## Extending it

Each new view follows the same two-layer pattern as the rest of the codebase (`architecture.md` §8): a pure `build<View>ViewModel(...)` function (plain objects in/out, Node-testable) plus a thin `get<View>ViewModel()` IO wrapper that calls `getAllRows(...)` and existing `*Logic.gs` functions, then hands the result to the pure builder. The frontend calls the IO wrapper via `FL.callServer('get<View>ViewModel', ...args)` (see `AppScript.html`). To add a view: add the pair of functions, add a route in `AppScript.html`'s `ROUTES` map, done — the router, styling, and helpers are already shared.
