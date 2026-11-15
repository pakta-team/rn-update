/**
 * [INPUT]: 依赖 Node 测试器/HTTP、临时 full 制品与共享 crash-rescue-server
 * [OUTPUT]: 验证先封锁 fix、阶段证据门卫、fix 不带 forceBoot、封存与请求身份留痕
 * [POS]: 真坏 JS 救援服务的离线契约回归，不冒充崩溃窗口或设备验收
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createRescueServer, HASHES } = require('./crash-rescue-server');

test('fix is withheld until device evidence, then offered without forceBoot and fully logged', async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pakta rescue server ')
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ['brick.ppk', 'fix.ppk'])
    fs.writeFileSync(path.join(directory, name), name);
  const evidence = path.join(directory, 'state.json');
  const { server } = createRescueServer({
    artifacts: directory,
    evidenceFile: evidence,
    runId: 'contract',
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      })
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) =>
    fetch(`${origin}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const check = (hash) => post('/checkUpdate/local-e2e-android', { hash });
  assert.equal((await (await check('')).json()).config.forceBoot, true);
  assert.equal((await fetch(`${origin}/artifacts/fix.ppk`)).status, 404);
  assert.deepEqual(await (await check(HASHES.brick)).json(), {
    upToDate: true,
  });
  assert.equal((await post('/control/phase', { phase: 'rescue' })).status, 409);
  assert.equal(
    (
      await post('/control/phase', {
        phase: 'rescue',
        evidence: { armed: true, fixAbsent: true },
      })
    ).status,
    200
  );
  const fix = await (await check(HASHES.brick)).json();
  assert.equal(fix.hash, HASHES.fix);
  assert.equal('config' in fix, false);
  assert.equal('forceBoot' in fix, false);
  fs.writeFileSync(
    path.join(directory, 'fix.ppk'),
    'changed after server start'
  );
  assert.equal((await fetch(`${origin}/artifacts/fix.ppk`)).status, 409);
  fs.writeFileSync(path.join(directory, 'fix.ppk'), 'fix.ppk');
  assert.equal(
    (await fetch(`${origin}/artifacts/fix.ppk`, { method: 'HEAD' })).status,
    200
  );
  assert.equal(
    await (await fetch(`${origin}/artifacts/fix.ppk`)).text(),
    'fix.ppk'
  );
  assert.equal((await post('/control/phase', { phase: 'sealed' })).status, 200);
  assert.deepEqual(await (await check(HASHES.fix)).json(), { upToDate: true });
  assert.equal((await fetch(`${origin}/artifacts/fix.ppk`)).status, 404);
  const state = await (await fetch(`${origin}/state`)).json();
  assert.equal(state.runId, 'contract');
  assert.equal(state.phase, 'sealed');
  assert.equal(
    state.requests.find((item) => item.returnedHash === HASHES.fix).forceBoot,
    false
  );
  assert.equal(state.artifacts.filter((item) => item.status === 200).length, 2);
  assert.equal(state.artifacts.filter((item) => item.status === 409).length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(evidence, 'utf8')), state);
  assert.throws(
    () => createRescueServer({ artifacts: directory, evidenceFile: evidence }),
    /fresh/
  );
});
