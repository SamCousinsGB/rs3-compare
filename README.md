# RS3 comparison

Compares ScarosZ and Dux Daedalus using Jagex's public RuneScape Platform API.

GitHub Actions fetches both players directly from RuneScape on pushes to `master`, manual runs, and hourly at minute 17. It validates the responses and deploys the site through GitHub Pages. Scheduled runs may be delayed by GitHub.

RuneMetrics was retired on 10 November 2026. The updater now uses the [Player Data API](https://developer.runescape.com/platform/modules/adventurers-log/player-data.html) with `includeSkills=true&includeQuests=true`, plus the [Player Events API](https://developer.runescape.com/platform/modules/adventurers-log/player-events.html). Neither requires an API key. All 29 named skills are mapped into the page's skill order, `fine_xp` is converted from tenths to whole XP, and overall totals are calculated from those skills. Quest counts come from the quest map; quest points use the authoritative `qp` and `qp_max` values, which account for special in-game quest rules. The six latest activities use ISO timestamps formatted as UTC dates. This also works for players absent from Hiscores.

Temporary network failures, timeouts, HTTP 408/429 and server errors get three attempts, waiting one then two seconds between attempts. If RuneScape is still unavailable, the workflow reports a deferred refresh in its warning and job summary and skips publishing. The last successful site and its original fetch timestamp remain unchanged; the next scheduled run tries again. A successful workflow with a deferred refresh does not mean the stats were updated. Invalid data, other HTTP errors, and code or filesystem errors still fail the workflow. Site changes pushed during an outage are also held until a complete stats refresh succeeds.

The browser reads `data/players.json` from this site. Refresh reloads the latest published data; it does not trigger a new upstream fetch. The page displays the fetch timestamp and flags data older than three hours. Requests time out after ten seconds, and failed refreshes retain the data already displayed.

- `npm test`: parser and page-state regression tests (no dependencies).
- `npm run update`: fetch both players and replace the local data snapshot only after successful validation; any failure exits nonzero locally.
- The workflow uses `npm run update -- --defer-on-outage` with `GITHUB_OUTPUT` to allow a deferred refresh and publishes only when `updated=true`.
- Serve this directory with a static HTTP server to preview it.

GitHub Pages must use GitHub Actions as its build source. The workflow only publishes `index.html`, `icons/`, and `data/`.
