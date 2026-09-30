import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHiscores, parseExtra } from '../scripts/data.mjs';

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
test('quest totals derive from the response and activity dates retain the year', () => {
  const result = parseExtra({ questscomplete: 1, questsstarted: 1, questsnotstarted: 0, activities: [{date:'07-Aug-2026 16:59',text:'Levelled up.'}] }, {quests:[{status:'COMPLETED',questPoints:3},{status:'STARTED',questPoints:2}]});
  assert.equal(result.qp, 3);
  assert.equal(result.qpTotal, 5);
  assert.equal(result.qTotal, 2);
  assert.equal(result.acts[0][0], '07 Aug 2026');
  assert.throws(() => parseExtra({error:'PROFILE_PRIVATE'}, {}));
});
