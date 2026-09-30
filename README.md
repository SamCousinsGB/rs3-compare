# RS3 comparison

Compares ScarosZ and Dux Daedalus using RuneScape hiscores and RuneMetrics.

GitHub Actions fetches both players directly from RuneScape on pushes to `master`, manual runs, and hourly at minute 17. It validates the responses and deploys the site through GitHub Pages. If any source fails, deployment stops and the last successful site stays published. Scheduled runs may be delayed by GitHub.

The browser reads `data/players.json` from this site. Refresh reloads the latest published data; it does not trigger a new upstream fetch. The page displays the fetch timestamp and flags data older than three hours. Requests time out after ten seconds, and failed refreshes retain the data already displayed.

- `npm test`: parser and page-state regression tests (no dependencies).
- `npm run update`: fetch both players and replace the local data snapshot only after successful validation.
- Serve this directory with a static HTTP server to preview it.

GitHub Pages must use GitHub Actions as its build source. The workflow only publishes `index.html`, `icons/`, and `data/`.
