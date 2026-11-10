import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fetchPlayer, UpstreamUnavailableError } from '../scripts/fetch-player.mjs';

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
  const waits = [];
  await assert.rejects(fetchPlayer('Dux Daedalus', fetchImpl, async ms => waits.push(ms)), error => {
    assert.ok(error instanceof UpstreamUnavailableError);
    assert.match(error.message, /HTTP 500.*index_lite/);
    return true;
  });
  assert.equal(calls.filter(url => url.includes('index_lite')).length, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

function failingProfile(failure) {
  let attempts = 0;
  const healthy = mockFetch().fetchImpl;
  return {
    get attempts() { return attempts; },
    fetchImpl: async url => {
      if (!url.includes('/profile/profile?')) return healthy(url);
      const outcome = failure(++attempts);
      if (outcome instanceof Error) throw outcome;
      if (outcome === 200) return healthy(url);
      return { ok: false, status: outcome };
    }
  };
}

test('transient profile HTTP failures exhaust a bounded retry budget', async t => {
  for (const status of [408, 429, 500, 502, 503, 599]) {
    await t.test(`HTTP ${status}`, async () => {
      const source = failingProfile(() => status);
      const waits = [];
      await assert.rejects(fetchPlayer('Dux Daedalus', source.fetchImpl, async ms => waits.push(ms)), error => {
        assert.ok(error instanceof UpstreamUnavailableError);
        assert.match(error.message, new RegExp(`HTTP ${status}.*profile/profile.*Dux%20Daedalus`));
        return true;
      });
      assert.equal(source.attempts, 3);
      assert.deepEqual(waits, [1000, 2000]);
    });
  }
});

test('profile refresh recovers after a temporary 502 and returns fresh data', async () => {
  const source = failingProfile(attempt => attempt < 3 ? 502 : 200);
  const waits = [];
  const player = await fetchPlayer('Dux Daedalus', source.fetchImpl, async ms => waits.push(ms));
  assert.equal(source.attempts, 3);
  assert.deepEqual(waits, [1000, 2000]);
  assert.deepEqual(player.skills[0], [2871, 200000]);
  assert.equal(player.extra.qp, 2);
});

test('network failures and timeouts are retryable outages', async t => {
  for (const failure of [new TypeError('fetch failed'), new TypeError('terminated'), new DOMException('The operation timed out', 'TimeoutError')]) {
    await t.test(`${failure.name}: ${failure.message}`, async () => {
      const source = failingProfile(() => failure);
      const waits = [];
      await assert.rejects(fetchPlayer('Dux Daedalus', source.fetchImpl, async ms => waits.push(ms)), UpstreamUnavailableError);
      assert.equal(source.attempts, 3);
      assert.deepEqual(waits, [1000, 2000]);
    });
  }
});

test('ordinary HTTP errors and programming errors fail without retrying', async t => {
  for (const failure of [400, 401, 403, 404, 422, new TypeError('Invalid test property'), new SyntaxError('Invalid JSON')]) {
    await t.test(String(failure), async () => {
      const source = failingProfile(() => failure);
      const waits = [];
      await assert.rejects(fetchPlayer('Dux Daedalus', source.fetchImpl, async ms => waits.push(ms)), error => {
        assert.ok(!(error instanceof UpstreamUnavailableError));
        return true;
      });
      assert.equal(source.attempts, 1);
      assert.deepEqual(waits, []);
    });
  }
});

test('malformed JSON remains fatal instead of becoming an outage', async () => {
  const healthy = mockFetch().fetchImpl;
  let profileAttempts = 0;
  const waits = [];
  await assert.rejects(fetchPlayer('Dux Daedalus', async url => {
    if (!url.includes('/profile/profile?')) return healthy(url);
    profileAttempts++;
    return { ok: true, status: 200, json: async () => { throw new SyntaxError('Invalid JSON'); } };
  }, async ms => waits.push(ms)), SyntaxError);
  assert.equal(profileAttempts, 1);
  assert.deepEqual(waits, []);
});

test('a permanent quest error takes precedence over a concurrent profile outage', async () => {
  const source = failingProfile(() => 502);
  await assert.rejects(fetchPlayer('Dux Daedalus', async url => {
    if (url.includes('/quests?')) return { ok: false, status: 403 };
    return source.fetchImpl(url);
  }, async () => {}), error => {
    assert.ok(!(error instanceof UpstreamUnavailableError));
    assert.match(error.message, /HTTP 403.*quests/);
    return true;
  });
});

test('invalid hiscores take precedence over a concurrent profile outage', async () => {
  const source = failingProfile(() => 502);
  await assert.rejects(fetchPlayer('Dux Daedalus', async url => {
    if (url.includes('index_lite')) return { ok: true, status: 200, text: async () => '<html>invalid hiscores</html>' };
    return source.fetchImpl(url);
  }, async () => {}), error => {
    assert.ok(!(error instanceof UpstreamUnavailableError));
    assert.match(error.message, /hiscores response/);
    return true;
  });
});

test('an invalid profile remains fatal alongside a quest outage', async () => {
  const source = mockFetch(200, { error: 'PROFILE_PRIVATE' }, hiscores, 502);
  await assert.rejects(fetchPlayer('Dux Daedalus', source.fetchImpl, async () => {}), error => {
    assert.ok(!(error instanceof UpstreamUnavailableError));
    assert.match(error.message, /Incomplete RuneMetrics response/);
    return true;
  });
});

test('invalid quest data remains fatal alongside a profile outage', async () => {
  const source = failingProfile(() => 502);
  await assert.rejects(fetchPlayer('Dux Daedalus', async url => {
    if (url.includes('/quests?')) return { ok: true, status: 200, json: async () => ({ quests: [] }) };
    return source.fetchImpl(url);
  }, async () => {}), error => {
    assert.ok(!(error instanceof UpstreamUnavailableError));
    assert.match(error.message, /Incomplete RuneMetrics response/);
    return true;
  });
});

test('invalid fallback skills remain fatal alongside a quest outage', async () => {
  const incomplete = structuredClone(profile);
  incomplete.skillvalues.pop();
  const source = mockFetch(404, incomplete, hiscores, 502);
  await assert.rejects(fetchPlayer('Dux Daedalus', source.fetchImpl, async () => {}), error => {
    assert.ok(!(error instanceof UpstreamUnavailableError));
    assert.match(error.message, /Incomplete RuneMetrics skills/);
    return true;
  });
});

test('malformed hiscores, incomplete fallback and quest failures stop the update', async () => {
  await assert.rejects(fetchPlayer('Dux Daedalus', mockFetch(200, profile, '<html>blocked</html>').fetchImpl), /hiscores response/);
  await assert.rejects(fetchPlayer('Dux Daedalus', mockFetch(404, { error: 'PROFILE_PRIVATE' }).fetchImpl), /Incomplete RuneMetrics response/);
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
      const env = { ...process.env };
      delete env.GITHUB_OUTPUT;
      delete env.GITHUB_STEP_SUMMARY;
      const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, updater], { cwd: resolve(directory), encoding: 'utf8', env });
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
