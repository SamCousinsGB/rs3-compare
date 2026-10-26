import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHiscores, parseRuneMetricsSkills, parseExtra } from '../scripts/data.mjs';

test('hiscores keep all 29 skills and exclude activity records', () => {
  const result = parseHiscores(['1,2378,133538936', ...Array(29).fill('50,99,13034431'), '1,999,42'].join('\n'));
  assert.equal(result.length, 30);
  assert.deepEqual(result[0], [2378, 133538936]);
  assert.deepEqual(result[29], [99, 13034431]);
});
test('rejects truncated, HTML, nonnumeric and unranked results', () => {
  for (const text of ['<html>blocked</html>', Array(30).fill('1,no,2').join('\n'), Array(30).fill('-1,-1,-1').join('\n')]) {
    assert.throws(() => parseHiscores(text));
  }
});

function metricsProfile() {
  return { totalskill: 290, totalxp: 789012,
    skillvalues: Array.from({ length: 29 }, (_, id) => ({ id, level: 10, xp: 12345 + id * 10 })).reverse() };
}

test('RuneMetrics skills use skill ID order and convert only skill XP from tenths', () => {
  const result = parseRuneMetricsSkills(metricsProfile());
  assert.equal(result.length, 30);
  assert.deepEqual(result[0], [290, 789012]);
  assert.deepEqual(result[1], [10, 1234]);
  assert.deepEqual(result[29], [10, 1262]);
});

test('RuneMetrics fallback rejects incomplete, duplicate, invalid and inconsistent skills', () => {
  const changes = [
    p => p.skillvalues.pop(),
    p => p.skillvalues.push({ id: 29, level: 10, xp: 0 }),
    p => { p.skillvalues[0].id = p.skillvalues[1].id; },
    p => { p.skillvalues[0].id = 29; },
    p => { p.skillvalues[0].id = 0.5; },
    p => { p.skillvalues[0] = null; },
    p => { p.skillvalues[0].level = 121; },
    p => { p.skillvalues[0].level = 0; },
    p => { p.skillvalues[0].xp = -1; },
    p => { p.skillvalues[0].xp = '100'; },
    p => { p.skillvalues[0].xp = Number.MAX_SAFE_INTEGER + 1; },
    p => { p.totalxp = NaN; },
    p => { p.totalskill++; }
  ];
  for (const change of changes) {
    const profile = metricsProfile();
    change(profile);
    assert.throws(() => parseRuneMetricsSkills(profile));
  }
  assert.throws(() => parseRuneMetricsSkills({ error: 'PROFILE_PRIVATE' }));
});
test('quest totals derive from the response and activity dates retain the year', () => {
  const result = parseExtra({ questscomplete: 1, questsstarted: 1, questsnotstarted: 0, activities: [{date:'07-Aug-2026 16:59',text:'Levelled up.'}] }, {quests:[{status:'COMPLETED',questPoints:3},{status:'STARTED',questPoints:2}]});
  assert.equal(result.qp, 3);
  assert.equal(result.qpTotal, 5);
  assert.equal(result.qTotal, 2);
  assert.equal(result.acts[0][0], '07 Aug 2026');
  assert.throws(() => parseExtra({error:'PROFILE_PRIVATE'}, {}));
});
