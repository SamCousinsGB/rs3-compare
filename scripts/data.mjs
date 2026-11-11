export const PLAYERS = ['ScarosZ', 'Dux Daedalus'];

// Platform API names in the same skill order used by the comparison page.
export const SKILL_KEYS = [
  'attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic',
  'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
  'smithing', 'mining', 'herblore', 'agility', 'thieving', 'slayer', 'farming',
  'runecraft', 'hunter', 'construction', 'summoning', 'dungeoneering',
  'divination', 'invention', 'archaeology', 'necromancy'
];

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;

export function parsePlayerData(response) {
  if (!isObject(response) || typeof response.name !== 'string' || !response.name.trim() ||
      !isObject(response.skills) || Object.keys(response.skills).length !== SKILL_KEYS.length) {
    throw new Error('Incomplete Platform API player data');
  }
  const skills = SKILL_KEYS.map(name => {
    const skill = response.skills[name];
    if (!isObject(skill) || !Number.isInteger(skill.level) || skill.level < 1 || skill.level > 120 || !nonnegativeInteger(skill.fine_xp)) {
      throw new Error('Invalid Platform API skill: ' + name);
    }
    return [skill.level, Math.floor(skill.fine_xp / 10)];
  });
  const total = skills.reduce(([levels, xp], skill) => [levels + skill[0], xp + skill[1]], [0, 0]);
  if (!total.every(nonnegativeInteger)) throw new Error('Invalid Platform API skill totals');

  if (!nonnegativeInteger(response.qp) || !nonnegativeInteger(response.qp_max) || response.qp > response.qp_max ||
      !isObject(response.quests) || !Object.keys(response.quests).length) {
    throw new Error('Incomplete Platform API quest data');
  }
  const quests = Object.values(response.quests);
  if (quests.some(quest => !isObject(quest) || !nonnegativeInteger(quest.qp) || !['NOT_STARTED', 'STARTED', 'COMPLETED'].includes(quest.status))) {
    throw new Error('Invalid Platform API quest data');
  }
  return {
    skills: [total, ...skills],
    extra: {
      // Jagex's totals include special quest rules; summing quest rewards is incorrect.
      qp: response.qp,
      qpTotal: response.qp_max,
      qDone: quests.filter(quest => quest.status === 'COMPLETED').length,
      qTotal: quests.length
    }
  };
}

const eventDate = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
});

export function parsePlayerEvents(response) {
  if (!isObject(response) || typeof response.name !== 'string' || !response.name.trim() || !Array.isArray(response.events)) {
    throw new Error('Incomplete Platform API events');
  }
  if (response.events.some(event => !isObject(event) || typeof event.text !== 'string' || typeof event.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(event.date) || !Number.isFinite(Date.parse(event.date)))) {
    throw new Error('Invalid Platform API event');
  }
  return response.events.slice(0, 6).map(event => [eventDate.format(new Date(event.date)), event.text.replace(/\s+/g, ' ').trim()]);
}
