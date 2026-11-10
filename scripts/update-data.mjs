import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { PLAYERS } from './data.mjs';
import { allOrThrow, fetchPlayer, UpstreamUnavailableError } from './fetch-player.mjs';

async function update() {
  let entries;
  try {
    entries = await allOrThrow(PLAYERS.map(async name => [name, await fetchPlayer(name)]));
  } catch (error) {
    if (!(error instanceof UpstreamUnavailableError) || !process.argv.includes('--defer-on-outage') || !process.env.GITHUB_OUTPUT) throw error;
    // The workflow must skip publishing, not deploy the old snapshot from checkout.
    await appendFile(process.env.GITHUB_OUTPUT, 'updated=false\n');
    const message = 'Stats refresh deferred: RuneScape is temporarily unavailable after three attempts. Publishing was skipped; the last published site and its original fetch timestamp remain unchanged. The next scheduled run will try again.';
    console.warn(`::warning title=RuneScape update delayed::${message}`);
    console.warn(error.message);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Stats refresh deferred\n\n${message}\n`);
    }
    return;
  }
  // Write only after every response is valid; an outage never rewrites the timestamp.
  await mkdir('data', { recursive: true });
  await writeFile('data/players.json', JSON.stringify({ updatedAt: new Date().toISOString(), players: Object.fromEntries(entries) }, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'updated=true\n');
  console.log('Updated both players from RuneScape.');
}

await update();
