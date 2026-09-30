export const PLAYERS = ['ScarosZ', 'Dux Daedalus'];

export function parseHiscores(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 30) throw new Error('Incomplete hiscores response');
  return lines.slice(0, 30).map((line, index) => {
    const parts = line.split(',').map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isSafeInteger(n)) || parts[1] < 1 || parts[2] < 0 || (index > 0 && parts[1] > 120)) {
      throw new Error('Invalid hiscores response');
    }
    return parts.slice(1);
  });
}

export function parseExtra(profile, response) {
  if (!Number.isInteger(profile.questscomplete) || !Array.isArray(profile.activities) || !Array.isArray(response.quests) || !response.quests.length) {
    throw new Error('Incomplete RuneMetrics response');
  }
  const quests = response.quests;
  if (quests.some(q => !Number.isInteger(q.questPoints) || q.questPoints < 0 || typeof q.status !== 'string')) throw new Error('Invalid quest data');
  return {
    qp: quests.reduce((sum, q) => sum + (q.status === 'COMPLETED' ? q.questPoints : 0), 0),
    qpTotal: quests.reduce((sum, q) => sum + q.questPoints, 0),
    qDone: profile.questscomplete,
    qTotal: profile.questscomplete + profile.questsstarted + profile.questsnotstarted,
    acts: profile.activities.slice(0, 6).map(a => [String(a.date || '').split(' ')[0].replaceAll('-', ' '), String(a.text || '').replace(/\s+/g, ' ').trim()])
  };
}
