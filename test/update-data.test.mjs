import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import playerData from './fixtures/player-data.json' with { type: 'json' };
import playerEvents from './fixtures/player-events.json' with { type: 'json' };

const updater = fileURLToPath(new URL('../scripts/update-data.mjs', import.meta.url));
const before = '{"previous":"published snapshot"}\n';

function runUpdate({ scenario = 'outage', defer = true, output = true, summary = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rs3-compare-outage-'));
  try {
    mkdirSync(join(directory, 'data'));
    const snapshotPath = join(directory, 'data/players.json');
    const outputPath = join(directory, 'github-output');
    const summaryPath = join(directory, 'github-summary');
    writeFileSync(snapshotPath, before);
    const env = { ...process.env };
    delete env.GITHUB_OUTPUT;
    delete env.GITHUB_STEP_SUMMARY;
    if (output) {
      env.GITHUB_OUTPUT = outputPath;
      writeFileSync(outputPath, 'existing=value\n');
    }
    if (summary) env.GITHUB_STEP_SUMMARY = summaryPath;
    const preload = `
      import timers from 'node:timers/promises';
      import { syncBuiltinESMExports } from 'node:module';
      timers.setTimeout = async () => {};
      syncBuiltinESMExports();
      const scenario = ${JSON.stringify(scenario)};
      const data = ${JSON.stringify(playerData)};
      const events = ${JSON.stringify(playerEvents)};
      globalThis.fetch = async url => {
        const parsed = new URL(url);
        if (parsed.hostname !== 'secure.runescape.com' || !parsed.pathname.startsWith('/m=adventurers-log/api/v1/')) {
          throw new Error('Unexpected legacy API request: ' + url);
        }
        const player = decodeURIComponent(parsed.pathname.split('/').at(-1));
        const isData = parsed.pathname.includes('/playerData/');
        if (['outage', 'mixed-validation', 'mixed-permanent'].includes(scenario) && player === 'Dux Daedalus' && isData) {
          return { ok: false, status: 502 };
        }
        if (scenario === 'mixed-permanent' && player === 'ScarosZ' && !isData) {
          return { ok: false, status: 403 };
        }
        const invalid = scenario === 'invalid' || (scenario === 'mixed-validation' && player === 'ScarosZ');
        return { ok: true, status: 200,
          json: async () => isData ? invalid ? { error: 'PROFILE_PRIVATE' } : { ...data, name: player } : { ...events, name: player } };
      };
    `;
    const args = ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, updater];
    if (defer) args.push('--defer-on-outage');
    const result = spawnSync(process.execPath, args, { cwd: directory, encoding: 'utf8', env, timeout: 15000 });
    assert.ifError(result.error);
    return {
      ...result,
      snapshot: readFileSync(snapshotPath, 'utf8'),
      output: existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '',
      summary: existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : ''
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('an exhausted player-data 502 defers publication and preserves the snapshot byte-for-byte', () => {
  const result = runUpdate();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.snapshot, before);
  assert.match(result.output, /^existing=value\n/m);
  assert.match(result.output, /^updated=false$/m);
  assert.doesNotMatch(result.output, /updated=true/);
  assert.match(result.stdout + result.stderr, /::warning(?: [^\r\n]*)?::/);
  assert.match(result.summary, /defer/i);
  assert.match(result.summary, /last (?:successfully )?published|published.*retain|retain.*published/i);
  assert.match(result.stdout + result.stderr, /502/);
});

test('deferral does not require a step-summary destination', () => {
  const result = runUpdate({ summary: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.snapshot, before);
  assert.match(result.output, /^updated=false$/m);
});

test('an outage remains fatal without both explicit deferral and an Actions output destination', () => {
  for (const options of [{ defer: false }, { output: false }, { defer: false, output: false }]) {
    const result = runUpdate(options);
    assert.notEqual(result.status, 0);
    assert.equal(result.snapshot, before);
    assert.doesNotMatch(result.output, /updated=(?:true|false)/);
    assert.match(result.stderr, /502/);
  }
});

test('successful refresh writes both fresh players and enables publication', () => {
  const result = runUpdate({ scenario: 'success' });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.snapshot);
  assert.deepEqual(Object.keys(data.players), ['ScarosZ', 'Dux Daedalus']);
  assert.ok(Math.abs(Date.now() - Date.parse(data.updatedAt)) < 30000);
  assert.deepEqual(data.players['Dux Daedalus'].skills[0], [435, 36192]);
  assert.equal(data.players['Dux Daedalus'].skills.length, 30);
  assert.equal(data.players['Dux Daedalus'].extra.qp, 7);
  assert.deepEqual(data.players['Dux Daedalus'].extra.acts[0], ['07 Aug 2026', 'Levelled up Attack.']);
  assert.match(result.output, /^existing=value\n/m);
  assert.match(result.output, /^updated=true$/m);
  assert.doesNotMatch(result.output, /updated=false/);
});

test('invalid data and permanent errors still fail even alongside another player outage', () => {
  for (const scenario of ['invalid', 'mixed-validation', 'mixed-permanent']) {
    const result = runUpdate({ scenario });
    assert.notEqual(result.status, 0, scenario);
    assert.equal(result.snapshot, before);
    assert.doesNotMatch(result.output, /updated=(?:true|false)/);
    assert.match(result.stderr, scenario === 'mixed-permanent' ? /HTTP 403/ : /Adventurer|player data|profile/i);
  }
});
