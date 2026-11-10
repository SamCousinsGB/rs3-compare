import { parseHiscores, parseRuneMetricsSkills, parseExtra, validateProfileExtras, validateQuests } from './data.mjs';
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

async function request(url, json, fetchImpl, wait) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        throw Object.assign(new Error(`RuneScape returned HTTP ${response.status} for ${url}`), { status: response.status });
      }
      return json ? await response.json() : await response.text();
    } catch (e) {
      if (!isTransient(e)) throw e;
      if (attempt === 2) throw new UpstreamUnavailableError(e);
      await wait(1000 * 2 ** attempt);
    }
  }
}

export async function fetchPlayer(name, fetchImpl = fetch, wait = delay) {
  const user = encodeURIComponent(name);
  const hiscoresRequest = request(`https://secure.runescape.com/m=hiscore/index_lite.ws?player=${user}`, false, fetchImpl, wait)
    .then(parseHiscores)
    .catch(error => { if (error.status === 404) return null; throw error; });
  const profileRequest = request(`https://apps.runescape.com/runemetrics/profile/profile?user=${user}&activities=6`, true, fetchImpl, wait)
    .then(validateProfileExtras);
  const questsRequest = request(`https://apps.runescape.com/runemetrics/quests?user=${user}`, true, fetchImpl, wait)
    .then(validateQuests);
  const skillsRequest = allOrThrow([hiscoresRequest, profileRequest]).then(([hiscores, profile]) => {
    if (hiscores !== null) return hiscores;
    const skills = parseRuneMetricsSkills(profile);
    console.warn(`Hiscores unavailable for ${name}; using validated RuneMetrics skills.`);
    return skills;
  });
  const [skills, profile, quests] = await allOrThrow([
    skillsRequest, profileRequest, questsRequest
  ]);
  const extra = parseExtra(profile, quests);
  return { skills, extra };
}
