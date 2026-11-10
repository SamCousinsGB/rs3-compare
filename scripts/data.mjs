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

export function parseRuneMetricsSkills(profile) {
  if (!Number.isSafeInteger(profile.totalskill) || profile.totalskill < 29 ||
      !Number.isSafeInteger(profile.totalxp) || profile.totalxp < 0 ||
      !Array.isArray(profile.skillvalues) || profile.skillvalues.length !== 29) {
    throw new Error('Incomplete RuneMetrics skills');
  }
  const skills = new Map();
  for (const skill of profile.skillvalues) {
    if (!skill || !Number.isInteger(skill.id) || skill.id < 0 || skill.id > 28 ||
        skills.has(skill.id) || !Number.isInteger(skill.level) || skill.level < 1 || skill.level > 120 ||
        !Number.isSafeInteger(skill.xp) || skill.xp < 0) {
      throw new Error('Invalid RuneMetrics skills');
    }
    // RuneMetrics supplies skill XP in tenths; overall totalxp is already whole XP.
    skills.set(skill.id, [skill.level, Math.floor(skill.xp / 10)]);
  }
  if ([...skills.values()].reduce((total, [level]) => total + level, 0) !== profile.totalskill) {
    throw new Error('Inconsistent RuneMetrics total level');
  }
  return [[profile.totalskill, profile.totalxp], ...Array.from({ length: 29 }, (_, id) => skills.get(id))];
}

export function validateProfileExtras(profile) {
  if (!profile || ['questscomplete', 'questsstarted', 'questsnotstarted'].some(key => !Number.isSafeInteger(profile[key]) || profile[key] < 0) || !Array.isArray(profile.activities)) {
    throw new Error('Incomplete RuneMetrics response');
  }
  if (profile.activities.some(activity => !activity || typeof activity !== 'object')) throw new Error('Invalid activity data');
  return profile;
}

export function validateQuests(response) {
  if (!response || !Array.isArray(response.quests) || !response.quests.length) throw new Error('Incomplete RuneMetrics response');
  if (response.quests.some(q => !q || !Number.isSafeInteger(q.questPoints) || q.questPoints < 0 || typeof q.status !== 'string')) throw new Error('Invalid quest data');
  return response;
}

export function parseExtra(profile, response) {
  validateProfileExtras(profile);
  validateQuests(response);
  const quests = response.quests;
  return {
    qp: quests.reduce((sum, q) => sum + (q.status === 'COMPLETED' ? q.questPoints : 0), 0),
    qpTotal: quests.reduce((sum, q) => sum + q.questPoints, 0),
    qDone: profile.questscomplete,
    qTotal: profile.questscomplete + profile.questsstarted + profile.questsnotstarted,
    acts: profile.activities.slice(0, 6).map(a => [String(a.date || '').split(' ')[0].replaceAll('-', ' '), String(a.text || '').replace(/\s+/g, ' ').trim()])
  };
}
