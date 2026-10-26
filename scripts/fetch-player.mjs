import { parseHiscores, parseRuneMetricsSkills, parseExtra } from './data.mjs';

async function request(url, json, fetchImpl) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        throw Object.assign(new Error(`RuneScape returned HTTP ${response.status} for ${url}`), { status: response.status });
      }
      return json ? await response.json() : await response.text();
    } catch (e) {
      if (e.status === 404) throw e;
      error = e;
    }
  }
  throw error;
}

export async function fetchPlayer(name, fetchImpl = fetch) {
  const user = encodeURIComponent(name);
  const [hiscores, profile, quests] = await Promise.all([
    request(`https://secure.runescape.com/m=hiscore/index_lite.ws?player=${user}`, false, fetchImpl)
      .catch(error => { if (error.status === 404) return null; throw error; }),
    request(`https://apps.runescape.com/runemetrics/profile/profile?user=${user}&activities=6`, true, fetchImpl),
    request(`https://apps.runescape.com/runemetrics/quests?user=${user}`, true, fetchImpl)
  ]);
  const skills = hiscores === null ? parseRuneMetricsSkills(profile) : parseHiscores(hiscores);
  const extra = parseExtra(profile, quests);
  if (hiscores === null) console.warn(`Hiscores unavailable for ${name}; using validated RuneMetrics skills.`);
  return { skills, extra };
}
