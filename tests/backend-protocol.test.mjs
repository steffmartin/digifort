import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Trecho ausente: ${start}`);
  return source.slice(from, to);
}
const context = vm.createContext({ createHash, URL, URLSearchParams, path });
vm.runInContext(section('function md5(', 'const DIGIFORT_REQUEST_HEADERS') + section('const AUTH_QUERY_KEYS', 'async function fetchDigifort(') + section('function extractSession(', 'async function createAuthState(') + section('function mediaTarget(', 'async function writeRequestToStream(') + section('function safeErrorCategory(', 'async function handleApi('), context);

test('monta autenticação e URL com codificação de parâmetros', () => {
  assert.equal(context.makeAuthData('abc', 'usuario', 'senha'), 'C8491A9872378EEBF48F2A46D69A87DE');
  const url = context.apiUrl({ serverAddress: 'http://localhost:1234', useBasicAuth: true, username: 'a b', password: 'x&y' }, 'Cameras/GetCameras', { Camera: 'Entrada & saída', Empty: '' });
  assert.equal(url.pathname, '/Interface/Cameras/GetCameras');
  assert.equal(url.searchParams.get('Camera'), 'Entrada & saída');
  assert.equal(url.searchParams.get('AuthPass'), 'x&y');
  assert.equal(url.searchParams.has('Empty'), false);
});

test('renova sessão uma vez após resposta não autorizada', async () => {
  const first = { id: 'primeira', authData: 'valor1' }, second = { id: 'segunda', authData: 'valor2' };
  const states = new Map([['teste', first]]), attempts = [], refreshes = [];
  let cancelled = false;
  const sandbox = vm.createContext({
    authStates: states,
    authState: async (_id, _config, refresh) => { refreshes.push(Boolean(refresh)); if (refresh) states.set('teste', second); return states.get('teste'); },
    apiUrl: (_config, _route, params) => params,
    fetchDigifort: async (_config, params) => { attempts.push(params.AuthSession); return attempts.length === 1 ? { status: 401, body: { cancel: async () => { cancelled = true; } } } : { status: 200 }; }
  });
  vm.runInContext(section('async function apiFetch(', 'function sendJson('), sandbox);
  const response = await sandbox.apiFetch('teste', { useBasicAuth: false }, 'Cameras/GetCameras', {}, undefined);
  assert.equal(response.status, 200);
  assert.deepEqual(attempts, ['primeira', 'segunda']);
  assert.deepEqual(refreshes, [false, true]);
  assert.equal(cancelled, true);
});

test('diagnóstico remove dados privados e classifica erros', () => {
  const target = context.safeApiTarget('http://localhost/Interface/Cameras?AuthData=segredo&Camera=entrada&StartDate=hoje&Profile=Recording');
  assert.doesNotMatch(target, /segredo|entrada|hoje/);
  assert.match(target, /Profile=Recording/);
  assert.equal(context.safeErrorCategory(new Error('Falha de transporte na etapa GetCameras (ECONNRESET).')), 'transport:GetCameras:ECONNRESET');
  assert.equal(context.safeErrorCategory(new Error('configuração inválida')), 'invalid-config');
  assert.equal(context.safeErrorCategory(new Error('segredo arbitrário')), 'request-failed');
});

test('aceita variações de sessão e rejeita respostas inválidas', async () => {
  const session = context.extractSession({ Response: { Data: { Session: { ID: 12, NOnce: 'abc' } } } });
  assert.equal(session.id, '12');
  assert.equal(session.nonce, 'abc');
  assert.throws(() => context.extractSession({}), /sessão válida/);
  const response = (text, ok = true) => ({ ok, text: async () => text });
  assert.equal((await context.readJsonResponse(response('{"Response":{"Code":0}}'))).Response.Code, 0);
  await assert.rejects(context.readJsonResponse(response('{"Response":{"Code":1}}')), /recusou/);
  await assert.rejects(context.readJsonResponse(response('não é JSON')), /resposta inválida/);
  await assert.rejects(context.readJsonResponse(response('{}', false)), /não aceitou/);
});

test('normaliza lista e estado de câmeras em formatos aninhado e plano', () => {
  const cameras = context.findCameras({ Response: { Data: [{ Name: 'Z', Active: 'FALSE', MediaProfiles: 'Visualization, Recording' }, { Name: 'A' }] } });
  assert.deepEqual(Array.from(cameras, camera => camera.name), ['A', 'Z']);
  assert.equal(cameras[1].active, false);
  assert.deepEqual(Array.from(cameras[1].profiles), ['Visualization', 'Recording']);
  const statuses = context.findCameraStatuses({ Data: { CAMERA_0_NAME: 'A', CAMERA_0_WORKING: 'yes', CAMERA_0_ACTIVETIME: '10', CAMERA_0_INACTIVETIME: '-1' } });
  assert.equal(statuses[0].working, true);
  assert.equal(statuses[0].activeTime, 10);
  assert.equal(statuses[0].inactiveTime, null);
});

test('destino de mídia rejeita travessia e extensões incompatíveis', () => {
  const config = { screenshotFolder: 'synthetic-images', videoFolder: 'synthetic-video' };
  assert.equal(path.basename(context.mediaTarget(config, 'camera-1.png', true).finalPath), 'camera-1.png');
  for (const filename of ['../imagem.png', 'imagem.mp4', 'imagem.png.exe', '']) assert.throws(() => context.mediaTarget(config, filename, true), /inválido/);
  assert.throws(() => context.mediaTarget({}, 'camera.mp4', false), /Defina/);
});
