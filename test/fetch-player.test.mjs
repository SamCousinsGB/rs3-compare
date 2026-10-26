import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fetchPlayer } from '../scripts/fetch-player.mjs';

const profile = {
  totalskill: 290, totalxp: 100000,
  skillvalues: Array.from({ length: 29 }, (_, id) => ({ id, level: 10, xp: 12345 })).reverse(),
  questscomplete: 1, questsstarted: 0, questsnotstarted: 0, activities: []
};
const quests = { quests: [{ status: 'COMPLETED', questPoints: 2 }] };
const hiscores = ['1,2871,200000', ...Array(29).fill('1,99,13034431')].join('\n');

function mockFetch(status = 200, metrics = profile, scores = hiscores, questStatus = 200) {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    const code = url.includes('index_lite') ? status : url.includes('/quests?') ? questStatus : 200;
    return { ok: code === 200, status: code, text: async () => scores,
      json: async () => url.includes('/quests?') ? quests : metrics };
  };
  return { fetchImpl, calls };
}

test('available hiscores remain the preferred source', async () => {
  const { fetchImpl, calls } = mockFetch();
  const player = await fetchPlayer('Dux Daedalus', fetchImpl);
  assert.deepEqual(player.skills[0], [2871, 200000]);
  assert.deepEqual(player.skills[1], [99, 13034431]);
  assert.equal(player.extra.qp, 2);
  assert.ok(calls.every(url => url.includes('Dux%20Daedalus')));
});

test('hiscores 404 falls back to complete RuneMetrics skills without retrying the 404', async () => {
  const { fetchImpl, calls } = mockFetch(404);
  const player = await fetchPlayer('Dux Daedalus', fetchImpl);
  assert.equal(player.skills.length, 30);
  assert.deepEqual(player.skills[0], [290, 100000]);
  assert.deepEqual(player.skills[29], [10, 1234]);
  assert.equal(calls.filter(url => url.includes('index_lite')).length, 1);
});

test('server errors retry and fail instead of using RuneMetrics', async () => {
  const { fetchImpl, calls } = mockFetch(500);
  await assert.rejects(fetchPlayer('Dux Daedalus', fetchImpl), /HTTP 500.*index_lite/);
  assert.equal(calls.filter(url => url.includes('index_lite')).length, 3);
});

test('malformed hiscores, incomplete fallback and quest failures stop the update', async () => {
  await assert.rejects(fetchPlayer('Dux Daedalus', mockFetch(200, profile, '<html>blocked</html>').fetchImpl), /hiscores response/);
  await assert.rejects(fetchPlayer('Dux Daedalus', mockFetch(404, { error: 'PROFILE_PRIVATE' }).fetchImpl), /Incomplete RuneMetrics skills/);
  await assert.rejects(fetchPlayer('Dux Daedalus', mockFetch(404, profile, hiscores, 404).fetchImpl), /HTTP 404.*quests/);
});

const updater = fileURLToPath(new URL('../scripts/update-data.mjs', import.meta.url));

test('updater writes both players with a 404 fallback and preserves the snapshot on invalid fallback', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rs3-compare-update-'));
  try {
    mkdirSync(join(directory, 'data'));
    const snapshotPath = join(directory, 'data/players.json');
    const before = '{"previous":"snapshot"}\n';
    writeFileSync(snapshotPath, before);
    // Run the actual updater against isolated files and deterministic HTTP responses.
    for (const valid of [false, true]) {
      const metrics = structuredClone(profile);
      if (!valid) metrics.skillvalues.pop();
      const preload = `globalThis.fetch = async url => ({ok: !url.includes('index_lite'), status: url.includes('index_lite') ? 404 : 200, json: async () => url.includes('/quests?') ? ${JSON.stringify(quests)} : ${JSON.stringify(metrics)}});`;
      const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, updater], { cwd: resolve(directory), encoding: 'utf8' });
      assert.ifError(result.error);
      assert.equal(result.status, valid ? 0 : 1, result.stderr);
      const written = readFileSync(snapshotPath, 'utf8');
      if (!valid) assert.equal(written, before);
      else {
        const data = JSON.parse(written);
        assert.deepEqual(Object.keys(data.players), ['ScarosZ', 'Dux Daedalus']);
        assert.ok(Number.isFinite(Date.parse(data.updatedAt)));
        assert.equal(data.players['Dux Daedalus'].skills.length, 30);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
