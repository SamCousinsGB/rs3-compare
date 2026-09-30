import { mkdir, writeFile } from 'node:fs/promises';
import { PLAYERS, parseHiscores, parseExtra } from './data.mjs';

async function request(url, json = false) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`RuneScape returned HTTP ${response.status}`);
      return json ? await response.json() : await response.text();
    } catch (e) { error = e; }
  }
  throw error;
}

const players = Object.fromEntries(await Promise.all(PLAYERS.map(async name => {
  const user = encodeURIComponent(name);
  const [hiscores, profile, quests] = await Promise.all([
    request(`https://secure.runescape.com/m=hiscore/index_lite.ws?player=${user}`),
    request(`https://apps.runescape.com/runemetrics/profile/profile?user=${user}&activities=6`, true),
    request(`https://apps.runescape.com/runemetrics/quests?user=${user}`, true)
  ]);
  return [name, { skills: parseHiscores(hiscores), extra: parseExtra(profile, quests) }];
})));
// Write only after every response is valid; a failed update leaves the published data intact.
await mkdir('data', { recursive: true });
await writeFile('data/players.json', JSON.stringify({ updatedAt: new Date().toISOString(), players }, null, 2) + '\n');
console.log('Updated both players from RuneScape.');
