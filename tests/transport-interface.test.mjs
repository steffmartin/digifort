import test from 'node:test';
import assert from 'node:assert/strict';
import { createDigifortTransport } from '../server/digifort.mjs';
import { createHttpAdapter } from '../server/http-adapter.mjs';

const config = { serverAddress: 'http://127.0.0.1:9999', userAgent: 'synthetic', username: 'test', password: 'test', useBasicAuth: false };
const session = id => new Response(JSON.stringify({ Response: { Code: 0, Data: { Session: { ID: id, NOnce: 'synthetic' } } } }));
const cameras = () => new Response(JSON.stringify({ Response: { Code: 0, Data: [{ Name: 'A', Active: 'TRUE' }] } }));

test('transporte renova a sessão uma vez e normaliza câmeras pelo adaptador sintético', async () => {
  const operations = [];
  let sessions = 0, calls = 0;
  const adapter = { async request(_config, _url, _options, operation) {
    operations.push(operation);
    if (operation === 'CreateAuthSession') return session(++sessions);
    if (operation === 'Cameras_GetCameras') return ++calls === 1 ? new Response('', { status: 401 }) : cameras();
    throw new Error('Operação inesperada no adaptador sintético.');
  } };
  const transport = createDigifortTransport({ adapter });
  transport.activate('synthetic');
  try {
    const result = await transport.cameras('synthetic', config);
    assert.deepEqual(result.map(camera => camera.name), ['A']);
    assert.deepEqual(operations, ['CreateAuthSession', 'Cameras_GetCameras', 'CreateAuthSession', 'Cameras_GetCameras']);
  } finally { transport.activate(''); }
});

test('transporte descarta criação de sessão de servidor que deixou de estar ativo', async () => {
  let resolveSession;
  const adapter = { request: () => new Promise(resolve => { resolveSession = resolve; }) };
  const transport = createDigifortTransport({ adapter });
  transport.activate('first');
  const pending = transport.cameras('first', config);
  transport.activate('second');
  resolveSession(session('synthetic'));
  await assert.rejects(pending, /Selecione novamente o servidor/);
  transport.activate('');
});

test('modo tradicional consulta câmeras sem criar uma sessão', async () => {
  const operations = [];
  const transport = createDigifortTransport({ adapter: { async request(_config, _url, _options, operation) {
    operations.push(operation);
    return cameras();
  } } });
  transport.activate('synthetic');
  try {
    const result = await transport.cameras('synthetic', { ...config, useBasicAuth: true });
    assert.deepEqual(result.map(camera => camera.name), ['A']);
    assert.deepEqual(operations, ['Cameras_GetCameras']);
  } finally { transport.activate(''); }
});

test('adaptador HTTP informa apenas operação e categoria sem expor dados privados', async () => {
  const diagnostics = [];
  const adapter = createHttpAdapter({ fetchImpl: async () => { throw Object.assign(new Error('private'), { cause: { code: 'ECONNRESET' } }); }, report: message => diagnostics.push(message) });
  const url = new URL('http://synthetic.invalid/Interface/Cameras/GetCameras?AuthData=secret&Camera=private-camera');
  await assert.rejects(adapter.request(config, url, {}, 'Cameras_GetCameras'), /ECONNRESET/);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /Cameras_GetCameras ECONNRESET/);
  assert.doesNotMatch(diagnostics[0], /secret|private-camera|synthetic\.invalid/);
});
