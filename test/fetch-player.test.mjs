import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPlayer, UpstreamUnavailableError } from '../scripts/fetch-player.mjs';
import playerData from './fixtures/player-data.json' with { type: 'json' };
import playerEvents from './fixtures/player-events.json' with { type: 'json' };

function mockFetch({ data = playerData, events = playerEvents, dataStatus = 200, eventStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    const isData = url.includes('/playerData/');
    const status = isData ? dataStatus : eventStatus;
    return { ok: status === 200, status, json: async () => isData ? data : events };
  };
  return { fetchImpl, calls };
}

test('only Adventurers Log APIs are used with encoded player names and requested fields', async () => {
  const { fetchImpl, calls } = mockFetch();
  const player = await fetchPlayer('Dux Daedalus', fetchImpl);
  assert.deepEqual(calls.sort(), [
    'https://secure.runescape.com/m=adventurers-log/api/v1/playerData/Dux%20Daedalus?includeSkills=true&includeQuests=true',
    'https://secure.runescape.com/m=adventurers-log/api/v1/playerEvents/Dux%20Daedalus'
  ]);
  assert.deepEqual(player.skills[0], [435, 36192]);
  assert.deepEqual(player.extra, {
    qp: 7, qpTotal: 500, qDone: 1, qTotal: 3,
    acts: [['07 Aug 2026', 'Levelled up Attack.'], ['07 Aug 2026', 'Event 2'],
      ['07 Aug 2026', 'Event 3'], ['07 Aug 2026', 'Event 4'], ['07 Aug 2026', 'Event 5'], ['31 Dec 2025', 'Event 6']]
  });
});

function failingEndpoint(failure, endpoint = '/playerData/') {
  let attempts = 0;
  const healthy = mockFetch().fetchImpl;
  return {
    get attempts() { return attempts; },
    fetchImpl: async url => {
      if (!url.includes(endpoint)) return healthy(url);
      const outcome = failure(++attempts);
      if (outcome instanceof Error) throw outcome;
      if (outcome === 200) return healthy(url);
      return { ok: false, status: outcome };
    }
  };
}

test('transient HTTP failures exhaust a bounded retry budget on either API', async t => {
  for (const status of [408, 429, 500, 502, 503, 599]) {
    await t.test('HTTP ' + status, async () => {
      const source = failingEndpoint(() => status);
      const waits = [];
      await assert.rejects(fetchPlayer('Dux Daedalus', source.fetchImpl, async ms => waits.push(ms)), error => {
        assert.ok(error instanceof UpstreamUnavailableError);
        assert.match(error.message, new RegExp('HTTP ' + status + '.*playerData/Dux%20Daedalus'));
        return true;
      });
      assert.equal(source.attempts, 3);
      assert.deepEqual(waits, [1000, 2000]);
    });
  }
  const events = failingEndpoint(() => 502, '/playerEvents/');
  await assert.rejects(fetchPlayer('Dux Daedalus', events.fetchImpl, async () => {}), UpstreamUnavailableError);
  assert.equal(events.attempts, 3);
});

test('refresh recovers after a temporary 502 and returns fresh data', async () => {
  const source = failingEndpoint(attempt => attempt < 3 ? 502 : 200);
  const waits = [];
  const player = await fetchPlayer('Dux Daedalus', source.fetchImpl, async ms => waits.push(ms));
  assert.equal(source.attempts, 3);
  assert.deepEqual(waits, [1000, 2000]);
  assert.deepEqual(player.skills[0], [435, 36192]);
  assert.equal(player.extra.qp, 7);
});

test('network failures and timeouts are retryable outages', async t => {
  for (const failure of [new TypeError('fetch failed'), new TypeError('terminated'), new DOMException('The operation timed out', 'TimeoutError')]) {
    await t.test(failure.name + ': ' + failure.message, async () => {
      const source = failingEndpoint(() => failure);
      const waits = [];
      await assert.rejects(fetchPlayer('Dux Daedalus', source.fetchImpl, async ms => waits.push(ms)), UpstreamUnavailableError);
      assert.equal(source.attempts, 3);
      assert.deepEqual(waits, [1000, 2000]);
    });
  }
});

test('ordinary HTTP errors and programming errors fail without retrying or legacy fallback', async t => {
  for (const failure of [400, 401, 403, 404, 422, new TypeError('Invalid test property'), new SyntaxError('Invalid JSON')]) {
    await t.test(String(failure), async () => {
      const source = failingEndpoint(() => failure);
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
  let dataAttempts = 0;
  const waits = [];
  await assert.rejects(fetchPlayer('Dux Daedalus', async url => {
    if (!url.includes('/playerData/')) return healthy(url);
    dataAttempts++;
    return { ok: true, status: 200, json: async () => { throw new SyntaxError('Invalid JSON'); } };
  }, async ms => waits.push(ms)), SyntaxError);
  assert.equal(dataAttempts, 1);
  assert.deepEqual(waits, []);
});

test('permanent HTTP failures take precedence over a concurrent outage', async () => {
  const source = mockFetch({ dataStatus: 502, eventStatus: 403 });
  await assert.rejects(fetchPlayer('Dux Daedalus', source.fetchImpl, async () => {}), error => {
    assert.ok(!(error instanceof UpstreamUnavailableError));
    assert.match(error.message, /HTTP 403.*playerEvents/);
    return true;
  });
});

test('invalid player data remains fatal alongside an events outage', async () => {
  for (const data of [{ error: 'PROFILE_PRIVATE' }, { ...playerData, quests: {} }, { ...playerData, skills: {} }]) {
    const source = mockFetch({ data, eventStatus: 502 });
    await assert.rejects(fetchPlayer('Dux Daedalus', source.fetchImpl, async () => {}), error => {
      assert.ok(!(error instanceof UpstreamUnavailableError));
      return true;
    });
  }
});

test('invalid events remain fatal alongside a player-data outage', async () => {
  const source = mockFetch({ dataStatus: 502, events: { name: 'Example Player', events: [{ date: 'bad date', text: 'Event' }] } });
  await assert.rejects(fetchPlayer('Dux Daedalus', source.fetchImpl, async () => {}), error => {
    assert.ok(!(error instanceof UpstreamUnavailableError));
    return true;
  });
});