import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/refresh\(\);\s*$/, '');
const data = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url), 'utf8'));
function harness(fetch) {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { innerHTML:'', textContent:'', classList:{ add(){}, remove(){} }, addEventListener(){} });
    return elements.get(id);
  }};
  let timeout;
  const context = vm.createContext({ document, fetch, AbortController, Date, setTimeout(fn){ timeout = fn; return 1; }, clearTimeout(){} });
  vm.runInContext(script, context);
  return { context, elements, run: code => vm.runInContext(code, context), timeout: () => timeout() };
}
test('renders both current players and consistent level ties; escapes activity text', async () => {
  const snapshot = structuredClone(data);
  snapshot.players.ScarosZ.skills[1] = [80, 2000000];
  snapshot.players['Dux Daedalus'].skills[1] = [80, 2100000];
  snapshot.players.ScarosZ.extra.acts[0][1] = '<img src=x onerror=alert(1)>';
  const page = harness(async () => ({ok:true,json:async()=>snapshot}));
  await page.run('refresh()');
  assert.match(page.elements.get('totals').innerHTML, /2,378/);
  assert.match(page.elements.get('feed').innerHTML, /&lt;img/);
  const attack = page.elements.get('rows').innerHTML.split('<div class="row">')[1];
  assert.match(attack, /gap tie/);
  assert.doesNotMatch(attack, /side (left|right) (win|lose)/);
  assert.equal(page.elements.get('refresh').disabled, false);
});
test('failed refresh retains last data and reports its actual timestamp', async () => {
  let fails = false;
  const page = harness(async () => { if(fails) throw new Error('offline'); return {ok:true,json:async()=>data}; });
  await page.run('refresh()');
  const previous = page.elements.get('rows').innerHTML;
  fails = true;
  await page.run('refresh()');
  assert.equal(page.elements.get('rows').innerHTML, previous);
  assert.match(page.elements.get('statusText').textContent, /Refresh failed · Showing data fetched/);
});
test('hung fetch times out, blocks overlapping refreshes, then allows retry', async () => {
  let requests = 0;
  const page = harness((url, {signal}) => { requests++; return new Promise((resolve,reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))); });
  const pending = page.run('refresh()');
  await page.run('refresh()');
  assert.equal(requests, 1);
  assert.equal(page.elements.get('refresh').disabled, true);
  page.timeout();
  await pending;
  assert.match(page.elements.get('statusText').textContent, /Stats unavailable/);
  assert.equal(page.elements.get('refresh').disabled, false);
});
test('invalid and partial updates never replace a complete comparison', async () => {
  const bad = structuredClone(data);
  delete bad.players['Dux Daedalus'];
  const page = harness(async () => ({ok:true,json:async()=>bad}));
  await page.run('refresh()');
  assert.equal(page.elements.has('totals'), false);
  assert.match(page.elements.get('statusText').textContent, /Stats unavailable/);
});
