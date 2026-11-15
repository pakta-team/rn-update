#!/usr/bin/env node
/**
 * [INPUT]: 依赖 Node HTTP/文件流、显式 brick.ppk/fix.ppk 与驱动确认的 armed/无预下载证据
 * [OUTPUT]: 提供 createRescueServer 及 CLI，按 brick→rescue→sealed 阶段交付 full 更新并保存请求/制品证据
 * [POS]: Android/iOS 真坏 JS 救援共享服务；仅 brick 带 forceBoot，fix 必须由原生崩溃窗口激活，服务端不伪造 crashRescue
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const HASHES = { brick: 'e2e-rescue-brick', fix: 'e2e-rescue-fix' };

function createRescueServer({
  artifacts,
  evidenceFile,
  runId = crypto.randomUUID(),
}) {
  if (evidenceFile && fs.existsSync(evidenceFile))
    throw new Error(`Choose a fresh rescue evidence file: ${evidenceFile}`);
  const root = fs.realpathSync(artifacts);
  const files = {};
  for (const name of ['brick.ppk', 'fix.ppk']) {
    const file = path.join(root, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size)
      throw new Error(`Expected physical nonempty rescue artifact: ${file}`);
    files[name] = {
      bytes: stat.size,
      sha256: crypto
        .createHash('sha256')
        .update(fs.readFileSync(file))
        .digest('hex'),
    };
  }
  const state = {
    runId,
    phase: 'brick',
    hashes: HASHES,
    files,
    requests: [],
    artifacts: [],
    transitions: [],
  };
  let sequence = 0;
  function save() {
    if (!evidenceFile) return;
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    const temporary = `${evidenceFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(temporary, evidenceFile);
  }
  function record(collection, value) {
    state[collection].push({
      seq: ++sequence,
      at: new Date().toISOString(),
      phase: state.phase,
      ...value,
    });
    save();
  }
  function json(response, body, status = 200) {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(body));
  }
  async function body(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 65536) throw new Error('Request body exceeds 64 KiB');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }
  save();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (request.method === 'GET' && url.pathname === '/state')
        return json(response, state);
      if (request.method === 'POST' && url.pathname === '/control/phase') {
        const value = await body(request);
        const allowed =
          (state.phase === 'brick' && value.phase === 'rescue') ||
          (state.phase === 'rescue' && value.phase === 'sealed');
        if (!allowed)
          return json(
            response,
            { error: 'Phase transition must be brick -> rescue -> sealed' },
            409
          );
        if (
          value.phase === 'rescue' &&
          (value.evidence?.armed !== true || value.evidence?.fixAbsent !== true)
        )
          return json(
            response,
            {
              error:
                'Rescue requires armed=true and fixAbsent=true device evidence',
            },
            409
          );
        const from = state.phase;
        state.phase = value.phase;
        record('transitions', {
          from,
          to: state.phase,
          evidence: value.evidence || {},
        });
        return json(response, { runId, phase: state.phase });
      }
      if (
        request.method === 'POST' &&
        url.pathname.startsWith('/checkUpdate/')
      ) {
        const payload = await body(request);
        const hash = typeof payload.hash === 'string' ? payload.hash : '';
        let result = { upToDate: true };
        if (state.phase === 'brick' && !hash) {
          result = {
            update: true,
            name: 'rescue-brick',
            hash: HASHES.brick,
            description: 'confirmed update that crashes on its next launch',
            paths: [`${url.origin}/artifacts`],
            full: 'brick.ppk',
            config: { forceBoot: true },
          };
        } else if (state.phase === 'rescue' && hash === HASHES.brick) {
          result = {
            update: true,
            name: 'rescue-fix',
            hash: HASHES.fix,
            description: 'fix must activate through native crash hold',
            paths: [`${url.origin}/artifacts`],
            full: 'fix.ppk',
          };
        }
        record('requests', {
          method: request.method,
          path: url.pathname,
          hash,
          body: payload,
          returnedHash: result.hash || null,
          forceBoot: result.config?.forceBoot === true,
        });
        return json(response, result);
      }
      if (
        url.pathname.startsWith('/artifacts/') &&
        ['GET', 'HEAD'].includes(request.method)
      ) {
        const name = url.pathname.slice('/artifacts/'.length);
        const allowed =
          (name === 'brick.ppk' && state.phase === 'brick') ||
          (name === 'fix.ppk' && state.phase === 'rescue');
        const status = allowed ? 200 : 404;
        if (!allowed) {
          record('artifacts', { method: request.method, name, status });
          return json(
            response,
            { error: 'Artifact withheld in this phase' },
            status
          );
        }
        const file = path.join(root, name);
        const actual = fs.readFileSync(file);
        if (
          actual.length !== files[name].bytes ||
          crypto.createHash('sha256').update(actual).digest('hex') !==
            files[name].sha256
        ) {
          record('artifacts', { method: request.method, name, status: 409 });
          return json(
            response,
            { error: `Rescue artifact changed while serving: ${name}` },
            409
          );
        }
        record('artifacts', { method: request.method, name, status });
        response.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': actual.length,
          'Cache-Control': 'no-store',
        });
        return response.end(request.method === 'HEAD' ? undefined : actual);
      }
      json(response, { error: 'Not found' }, 404);
    } catch (error) {
      if (!response.headersSent) json(response, { error: error.message }, 400);
      else response.destroy(error);
    }
  });
  return { server, state };
}

if (require.main === module) {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (
      !['--artifacts', '--evidence', '--run-id', '--host', '--port'].includes(
        key
      ) ||
      !value
    )
      throw new Error(
        'Usage: crash-rescue-server.js --artifacts DIR [--port 31337] [--host 0.0.0.0] [--evidence FILE] [--run-id ID]'
      );
    options[key.slice(2)] = value;
  }
  if (!options.artifacts) throw new Error('--artifacts is required');
  const port = Number(options.port || 31337);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid --port');
  const { server } = createRescueServer({
    artifacts: options.artifacts,
    evidenceFile: options.evidence,
    runId: options['run-id'],
  });
  server.listen(port, options.host || '0.0.0.0', () => {
    console.log(
      `crash rescue server listening on ${options.host || '0.0.0.0'}:${port}`
    );
  });
}

module.exports = { createRescueServer, HASHES };
