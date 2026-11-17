import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Trecho ausente: ${start}`);
  return source.slice(from, to);
}
const context = vm.createContext({ Intl, Date, URL });
vm.runInContext(section('function safeId(', 'async function readConfig(') + section('function configName(', 'async function getConfig('), context);
const valid = () => ({ serverAddress: 'http://127.0.0.1:9999/', userAgent: ' teste ', username: 'sintetico', password: 'exemplo', timeZone: 'America/Sao_Paulo', initialCameras: { Entrada: 'Visualization' } });

test('identificadores rejeitam travessia de diretórios e nomes especiais', () => {
  for (const id of ['../x', '.', '..', 'a/b', 'a\\b', '', 'a'.repeat(121), null]) assert.equal(context.safeId(id), false);
  for (const id of ['servidor-1', 'a_b.config', 'x'.repeat(120)]) assert.equal(context.safeId(id), true);
});

test('configuração aplica padrões e usa pasta de mídia como fallback', () => {
  const config = context.parseConfig('teste', { ...valid(), name: '  Central   Norte ', mediaFolder: ' midia ', initialMosaic: 'desconhecido' });
  assert.equal(config.name, 'Central Norte');
  assert.equal(config.serverAddress, 'http://127.0.0.1:9999');
  assert.equal(config.userAgent, 'teste');
  assert.equal(config.initialMosaic, 'auto');
  assert.equal(context.parseConfig('teste', { ...valid(), initialMosaic: '4x4-six' }).initialMosaic, '4x4-six');
  assert.equal(config.maxCams, 0);
  assert.equal(config.seekSeconds, 15);
  assert.equal(context.parseConfig('teste', { ...valid(), seekSeconds: 30 }).seekSeconds, 30);
  assert.equal(config.screenshotFolder, 'midia');
  assert.equal(config.videoFolder, 'midia');
  assert.equal(config.useBasicAuth, false);
});

test('configuração rejeita endereços inseguros e dados inválidos', () => {
  const invalid = [
    [{ serverAddress: 'ftp://localhost' }, /HTTP ou HTTPS/],
    [{ serverAddress: 'http://user:secret@localhost' }, /Remova usuário e senha/],
    [{ timeZone: 'Fuso/Inexistente' }, /fuso horário/],
    [{ initialCameras: { A: 'outro' } }, /perfil/],
    [{ initialCameras: { A: 'Recording', B: 'Visualization' }, maxCams: 1 }, /excede/],
    [{ maxCams: -1 }, /maxCams/],
    [{ seekSeconds: 0 }, /seekSeconds/],
    [{ seekSeconds: 1.5 }, /seekSeconds/],
    [{ useBasicAuth: 'true' }, /useBasicAuth/],
    [{ mediaFolder: 42 }, /mediaFolder/]
  ];
  for (const [override, error] of invalid) assert.throws(() => context.parseConfig('teste', { ...valid(), ...override }), error);
});


test('salvar grade preserva configuração e sessão e rejeita outra origem', async () => {
  const route = section("    if (url.pathname === '/api/grid') {", "    if (url.pathname === '/api/config') {");
  let saved;
  const previous = { ...valid(), extra: 'preservado', initialMosaic: 'auto' };
  const cache = new Map();
  const sandbox = vm.createContext({
    HOST: '127.0.0.1', PORT: 4177, CONFIG_DIR: '/synthetic', activeServerId: 'teste', configs: cache,
    path: { join: (...parts) => parts.join('/') }, safeId: context.safeId, parseConfig: context.parseConfig,
    queryValue: url => url.server, readConfig: async () => previous,
    fs: { writeFile: async (_path, text) => { saved = JSON.parse(text); } },
    sendJson: (_res, status, body) => ({ status, body })
  });
  vm.runInContext(`this.handle = async (req, res, url) => { ${route} };`, sandbox);
  const fields = { initialCameras: { B: 'Recording', A: 'Visualization' }, initialMosaic: '4x4-six' };
  const req = { method: 'PUT', headers: { host: '127.0.0.1:4177', origin: 'http://127.0.0.1:4177' }, async *[Symbol.asyncIterator]() { yield JSON.stringify(fields); } };
  const result = await sandbox.handle(req, {}, { pathname: '/api/grid', server: 'teste' });
  assert.equal(result.status, 200);
  assert.equal(saved.extra, 'preservado');
  assert.equal(saved.password, previous.password);
  assert.deepEqual(Object.keys(saved.initialCameras), ['B', 'A']);
  assert.equal(cache.get('teste').initialMosaic, '4x4-six');
  req.headers.origin = 'http://evil.invalid';
  assert.equal((await sandbox.handle(req, {}, { pathname: '/api/grid', server: 'teste' })).status, 403);
});
