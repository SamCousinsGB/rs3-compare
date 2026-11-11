import { parsePlayerData, parsePlayerEvents } from './data.mjs';
import { setTimeout as delay } from 'node:timers/promises';

export class UpstreamUnavailableError extends Error {
  constructor(cause) {
    super(`RuneScape temporarily unavailable: ${cause.message}`, { cause });
    this.name = 'UpstreamUnavailableError';
  }
}

function isTransient(error) {
  return error.status === 408 || error.status === 429 || (error.status >= 500 && error.status <= 599) ||
    error.name === 'TimeoutError' || error.name === 'AbortError' ||
    (error instanceof TypeError && ['fetch failed', 'terminated'].includes(error.message));
}

// Wait for every result so an outage cannot hide a concurrent permanent failure.
export async function allOrThrow(promises) {
  const results = await Promise.allSettled(promises);
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length) throw errors.find(error => !(error instanceof UpstreamUnavailableError)) ?? errors[0];
  return results.map(result => result.value);
}

async function request(url, fetchImpl, wait) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': 'rs3-compare/1.0 (+https://github.com/SamCousinsGB/rs3-compare)', Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        throw Object.assign(new Error(`RuneScape returned HTTP ${response.status} for ${url}`), { status: response.status });
      }
      return await response.json();
    } catch (e) {
      if (!isTransient(e)) throw e;
      if (attempt === 2) throw new UpstreamUnavailableError(e);
      await wait(1000 * 2 ** attempt);
    }
  }
}

export async function fetchPlayer(name, fetchImpl = fetch, wait = delay) {
  const user = encodeURIComponent(name);
  const base = 'https://secure.runescape.com/m=adventurers-log/api/v1';
  const [player, acts] = await allOrThrow([
    request(`${base}/playerData/${user}?includeSkills=true&includeQuests=true`, fetchImpl, wait).then(parsePlayerData),
    request(`${base}/playerEvents/${user}`, fetchImpl, wait).then(parsePlayerEvents)
  ]);
  return { skills: player.skills, extra: { ...player.extra, acts } };
}
