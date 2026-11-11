import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlayerData, parsePlayerEvents } from '../scripts/data.mjs';
import playerData from './fixtures/player-data.json' with { type: 'json' };
import playerEvents from './fixtures/player-events.json' with { type: 'json' };

test('named skills retain the page order despite shuffled API keys and convert fine XP', () => {
  const { skills } = parsePlayerData(playerData);
  assert.equal(skills.length, 30);
  assert.deepEqual(skills[0], [435, 36192]);
  assert.deepEqual(skills.slice(1), Array.from({ length: 29 }, (_, index) => [index + 1, 1234 + index]));
  assert.deepEqual(skills[4], [4, 1237]); // hitpoints maps to Constitution
  assert.deepEqual(skills[21], [21, 1254]); // runecraft maps to Runecrafting
  assert.deepEqual(skills[29], [29, 1262]);
});

test('quest points use authoritative totals and quest counts use all statuses', () => {
  const { extra } = parsePlayerData(playerData);
  assert.deepEqual(extra, { qp: 7, qpTotal: 500, qDone: 1, qTotal: 3 });
  // Completed quest points sum to 3, deliberately different from top-level qp=7.
  assert.notEqual(extra.qp, playerData.quests['1'].qp);
});

test('incomplete or invalid skill data cannot become a published snapshot', () => {
  const changes = [
    p => { delete p.skills.attack; },
    p => { p.skills.new_skill = { level: 1, fine_xp: 0 }; },
    p => { p.skills.constitution = p.skills.hitpoints; delete p.skills.hitpoints; },
    p => { p.skills.attack = null; },
    p => { p.skills.attack.level = 0; },
    p => { p.skills.attack.level = 121; },
    p => { p.skills.attack.level = 1.5; },
    p => { p.skills.attack.level = '99'; },
    p => { p.skills.attack.fine_xp = -1; },
    p => { p.skills.attack.fine_xp = 1.5; },
    p => { p.skills.attack.fine_xp = '100'; },
    p => { p.skills.attack.fine_xp = Number.MAX_SAFE_INTEGER + 1; },
    p => { p.skills = []; }
  ];
  for (const change of changes) {
    const response = structuredClone(playerData);
    change(response);
    assert.throws(() => parsePlayerData(response));
  }
});

test('private profiles and invalid quest schemas or totals are rejected', () => {
  for (const value of [null, {}, { error: 'PROFILE_PRIVATE' }]) assert.throws(() => parsePlayerData(value));
  const changes = [
    p => { delete p.name; },
    p => { p.name = 42; },
    p => { p.quests = {}; },
    p => { p.quests = []; },
    p => { p.quests['1'] = null; },
    p => { p.quests['1'].status = 'UNKNOWN'; },
    p => { p.quests['1'].qp = -1; },
    p => { p.quests['1'].qp = '3'; },
    p => { p.qp = -1; },
    p => { p.qp = 501; },
    p => { p.qp = 1.5; },
    p => { p.qp_max = Number.MAX_SAFE_INTEGER + 1; },
    p => { delete p.qp_max; }
  ];
  for (const change of changes) {
    const response = structuredClone(playerData);
    change(response);
    assert.throws(() => parsePlayerData(response));
  }
});

test('activities retain six title texts, normalized whitespace and UTC dates with years', () => {
  const activities = parsePlayerEvents(playerEvents);
  assert.equal(activities.length, 6);
  assert.deepEqual(activities[0], ['07 Aug 2026', 'Levelled up Attack.']);
  assert.deepEqual(activities[5], ['31 Dec 2025', 'Event 6']);
  assert.ok(activities.every(([, text]) => !text.includes('Long details')));
  assert.deepEqual(parsePlayerEvents({ name: 'Example Player', events: [] }), []);
});

test('malformed activities and ambiguous timestamps are rejected', () => {
  for (const value of [null, {}, { name: 'Example Player', events: {} }]) assert.throws(() => parsePlayerEvents(value));
  const changes = [
    p => { delete p.name; },
    p => { p.events[0] = null; },
    p => { p.events[0].text = 42; },
    p => { delete p.events[0].text; },
    p => { p.events[0].date = 'not a timestamp'; },
    p => { p.events[0].date = '2026-08-07T12:00:00'; },
    p => { p.events[0].date = '2026-08-07'; },
    p => { p.events[0].date = '2026-99-99T12:00:00Z'; },
    p => { p.events[0].date = 1786104000000; }
  ];
  for (const change of changes) {
    const response = structuredClone(playerEvents);
    change(response);
    assert.throws(() => parsePlayerEvents(response));
  }
});