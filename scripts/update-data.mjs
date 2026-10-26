import { mkdir, writeFile } from 'node:fs/promises';
import { PLAYERS } from './data.mjs';
import { fetchPlayer } from './fetch-player.mjs';

const players = Object.fromEntries(await Promise.all(PLAYERS.map(async name => {
  return [name, await fetchPlayer(name)];
})));
// Write only after every response is valid; a failed update leaves the published data intact.
await mkdir('data', { recursive: true });
await writeFile('data/players.json', JSON.stringify({ updatedAt: new Date().toISOString(), players }, null, 2) + '\n');
console.log('Updated both players from RuneScape.');
