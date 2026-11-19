import { createDigifortTransport } from './server/digifort.mjs';
import { createHttpAdapter } from './server/http-adapter.mjs';
import { finalizeMp4Duration } from './server/mp4-duration.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(process.env.DIGIFORT_CONFIG_DIR || path.join(ROOT, 'config'));
const PUBLIC_DIR = path.join(ROOT, 'public');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4177);
const launcher = process.argv.includes('--launcher');
const updateCapable = launcher && process.argv.includes('--update-capable') && process.platform === 'win32';
const configs = new Map();
const transport = createDigifortTransport({ adapter: createHttpAdapter() });
const mediaWriters = new Map();
const mediaRequests = new Set();
const streamChannels = new Set();
const UPDATE_FILE = path.join(CONFIG_DIR, 'update.json');
const RELEASE_API = 'https://api.github.com/repos/steffmartin/digifort/releases/latest';
let shuttingDown = false;
let activeServerId = '';

const safeError = (message, status = 400) => ({ status, body: { error: message } });

function versionParts(value) {
  const match = typeof value === 'string' && value.match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  return match ? match.slice(1).map(Number) : null;
}

async function checkUpdate() {
  try {
    const installed = versionParts(JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')).version);
    if (!installed) return null;
    const response = await fetch(RELEASE_API, { headers: { 'User-Agent': 'Digifort-Monitor', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = await response.json();
    const latest = versionParts(release.tag_name);
    if (!latest || !latest.some((part, i) => part > installed[i] && latest.slice(0, i).every((value, j) => value === installed[j]))) return null;
    let ignored = '';
    try { ignored = JSON.parse(await fs.readFile(UPDATE_FILE, 'utf8')).ignoredVersion; } catch {}
    if (versionParts(ignored)?.every((part, i) => part === latest[i])) return null;
    const version = latest.join('.');
    const name = `Digifort-Monitor-Setup-${version}.exe`;
    const asset = release.assets?.find(item => item.name === name);
    const checksums = release.assets?.find(item => item.name === 'SHA256SUMS.txt');
    const validUrl = item => { try { const url = new URL(item.browser_download_url); return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith('/steffmartin/digifort/releases/download/'); } catch { return false; } };
    return { version, url: `https://github.com/steffmartin/digifort/releases/tag/${encodeURIComponent(release.tag_name)}`, canInstall: Boolean(updateCapable && validUrl(asset) && validUrl(checksums)), ...(updateCapable && validUrl(asset) && validUrl(checksums) ? { assetUrl: asset.browser_download_url, checksumUrl: checksums.browser_download_url, name } : {}) };
  } catch (error) {
    console.debug(`Verificação de atualização indisponível (${error.name || 'erro'}).`);
    return null;
  }
}

const updateCheck = checkUpdate();
let updateIgnored = false;
let updateDownload = { status: 'idle', received: 0, total: 0 };
let updateInstaller = '';

async function downloadUpdate(update) {
  let directory;
  updateInstaller = '';
  try {
    const options = { headers: { 'User-Agent': 'Digifort-Monitor' }, signal: AbortSignal.timeout(300000) };
    const sums = await fetch(update.checksumUrl, options);
    if (!sums.ok || Number(sums.headers.get('content-length') || 0) > 65536) throw new Error('Checksum indisponível.');
    let text = '';
    for await (const chunk of sums.body) {
      text += Buffer.from(chunk).toString('utf8');
      if (text.length > 65536) throw new Error('Checksum inválido.');
    }
    const lines = text.split(/\r?\n/).map(line => line.match(/^([a-fA-F0-9]{64})\s+\*?([^\s]+)\s*$/)).filter(match => match && match[2] === update.name);
    if (lines.length !== 1) throw new Error('Checksum ausente ou ambíguo.');
    const response = await fetch(update.assetUrl, options);
    if (!response.ok || !response.body) throw new Error('Download indisponível.');
    const total = Number(response.headers.get('content-length') || 0);
    const maxSize = 256 * 1024 * 1024;
    if (!Number.isSafeInteger(total) || total < 0 || total > maxSize) throw new Error('Tamanho inválido.');
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'digifort-update-'));
    const target = path.join(directory, update.name);
    const file = await fs.open(target, 'wx');
    const hash = createHash('sha256');
    let received = 0;
    try {
      updateDownload = { status: 'downloading', received, total };
      for await (const chunk of response.body) {
        received += chunk.length;
        if (received > maxSize) throw new Error('Download excedeu o limite.');
        hash.update(chunk);
        await file.writeFile(chunk);
        updateDownload = { status: 'downloading', received, total };
      }
    } finally { await file.close(); }
    if ((total && received !== total) || hash.digest('hex') !== lines[0][1].toLowerCase()) throw new Error('SHA-256 divergente.');
    updateInstaller = target;
    updateDownload = { status: 'ready', received, total: total || received };
  } catch (error) {
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    updateDownload = { status: 'error', error: 'Não foi possível baixar ou verificar a atualização. Tente novamente.' };
    console.debug(`Atualização indisponível (${error.name || 'erro'}).`);
  }
}

function safeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,120}$/.test(value) && value !== '.' && value !== '..';
}

function parseTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

async function readConfig(id) {
  if (!safeId(id) || id.toLowerCase() === 'example') throw new Error('Configuração de servidor inválida.');
  const configPath = path.resolve(CONFIG_DIR, `${id}.config`);
  if (!configPath.startsWith(`${CONFIG_DIR}${path.sep}`)) throw new Error('Configuração de servidor inválida.');
  let source;
  try {
    source = await fs.readFile(configPath, 'utf8');
  } catch {
    throw new Error('Não foi possível ler o arquivo de configuração selecionado. Verifique se o arquivo existe e se está acessível.');
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    const position = Number(error?.message?.match(/position\s+(\d+)/i)?.[1] ?? source.length);
    const safePosition = Math.max(0, Math.min(position, source.length));
    const beforeError = source.slice(0, safePosition);
    const line = (beforeError.match(/\n/g) ?? []).length + 1;
    const column = safePosition - beforeError.lastIndexOf('\n');
    throw new Error(`O arquivo de configuração não contém JSON válido (linha ${line}, coluna ${column}). Salve como JSON UTF-8 sem BOM e revise aspas e vírgulas.`);
  }
  return value;
}

function configName(id, value) {
  return typeof value?.name === 'string' && value.name.trim()
    ? value.name.trim().replace(/\s+/g, ' ').slice(0, 120)
    : id;
}

function parseConfig(id, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A configuração deve ser um objeto JSON.');
  const { serverAddress, userAgent, username, password, timeZone, initialCameras } = value;
  const name = configName(id, value);
  const useBasicAuth = value.useBasicAuth ?? false;
  if (typeof serverAddress !== 'string' || !/^https?:\/\//i.test(serverAddress)) throw new Error('A configuração precisa de um endereço HTTP ou HTTPS válido.');
  let parsedAddress;
  try { parsedAddress = new URL(serverAddress); } catch { throw new Error('A configuração precisa de um endereço HTTP ou HTTPS válido.'); }
  if (parsedAddress.username || parsedAddress.password) throw new Error('Remova usuário e senha do endereço do servidor; use os campos próprios da configuração.');
  if (typeof userAgent !== 'string' || !userAgent.trim()) throw new Error('A configuração precisa informar um User-Agent.');
  if (typeof useBasicAuth !== 'boolean') throw new Error('useBasicAuth deve ser true ou false.');
  if (typeof username !== 'string' || !username.trim()) throw new Error('A configuração precisa informar o usuário.');
  if (typeof password !== 'string') throw new Error('A configuração precisa informar a senha.');
  if (typeof timeZone !== 'string' || !parseTimeZone(timeZone)) throw new Error('A configuração precisa informar um fuso horário IANA válido.');
  if (!initialCameras || typeof initialCameras !== 'object' || Array.isArray(initialCameras)) throw new Error('initialCameras deve ser um mapa de câmeras para perfis.');
  for (const [camera, profile] of Object.entries(initialCameras)) {
    if (!camera.trim() || !['Visualization', 'Recording'].includes(profile)) throw new Error('Cada câmera inicial precisa ter um nome e o perfil Visualization ou Recording.');
  }
  const maxCams = value.maxCams ?? 0;
  if (!Number.isSafeInteger(maxCams) || maxCams < 0) throw new Error('maxCams deve ser um inteiro maior ou igual a zero.');
  const seekSeconds = value.seekSeconds ?? 15;
  if (!Number.isSafeInteger(seekSeconds) || seekSeconds < 1 || seekSeconds > 8640000000000) throw new Error('seekSeconds deve ser um inteiro positivo válido.');
  if (maxCams && Object.keys(initialCameras).length > maxCams) throw new Error('initialCameras excede o limite maxCams da configuração.');
  const mosaicIds = new Set(['auto', '3x3-six', '4x4-six', '4x4-eight', '4x4-ten', '4x4-thirteen-a', '4x4-thirteen-b', '4x4-center']);
  const initialMosaic = mosaicIds.has(value.initialMosaic) ? value.initialMosaic : 'auto';
  for (const key of ['mediaFolder', 'screenshotFolder', 'videoFolder']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error(`${key} deve ser um caminho de pasta ou uma string vazia.`);
  }
  const mediaFolder = value.mediaFolder?.trim() || '';
  const screenshotFolder = value.screenshotFolder?.trim() || mediaFolder;
  const videoFolder = value.videoFolder?.trim() || mediaFolder;
  return { id, name, serverAddress: serverAddress.replace(/\/+$/, ''), userAgent: userAgent.trim(), username, password, useBasicAuth, timeZone, initialCameras, initialMosaic, maxCams, seekSeconds, screenshotFolder, videoFolder };
}

async function getConfig(id) {
  if (configs.has(id)) return configs.get(id);
  const parsed = parseConfig(id, await readConfig(id));
  configs.set(id, parsed);
  return parsed;
}

async function serverOptions() {
  let entries;
  try {
    entries = await fs.readdir(CONFIG_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const ids = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.config') && entry.name.toLowerCase() !== 'example.config')
    .map(entry => entry.name.slice(0, -'.config'.length))
    .filter(safeId)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return Promise.all(ids.map(async id => {
    let name = id;
    try {
      const value = await readConfig(id);
      name = configName(id, value);
      parseConfig(id, value);
      return { id, name, ready: true };
    } catch {
      return { id, name, ready: false };
    }
  }));
}

function activateServer(id) {
  if (activeServerId === id) return;
  transport.activate(id);
  for (const serverId of configs.keys()) if (serverId !== id) configs.delete(serverId);
  activeServerId = id;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function mediaTarget(config, filename, screenshot) {
  const key = screenshot ? 'screenshotFolder' : 'videoFolder';
  if (!config[key]) throw new Error(`Defina ${key} ou mediaFolder no arquivo de configuração do servidor.`);
  const validName = screenshot ? /^[\p{L}\p{N}_-]{1,100}\.png$/u : /^[\p{L}\p{N}_-]{1,100}\.mp4$/u;
  if (typeof filename !== 'string' || !validName.test(filename)) throw new Error('Nome de arquivo de mídia inválido.');
  const folder = path.resolve(config[key]);
  return { folder, finalPath: path.join(folder, filename), partPath: path.join(folder, `${filename}.part`) };
}

async function writeRequestToStream(req, stream) {
  for await (const chunk of req) {
    await new Promise((resolve, reject) => {
      stream.write(chunk, error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function finishRecording(writer, recover = false) {
  const { stream, partPath, finalPath, completedBytes } = writer;
  try {
    if (!stream.closed) {
      const closed = once(stream, 'close');
      stream.end();
      await closed;
    }
    if (recover) {
      if (completedBytes === 0) {
        await fs.unlink(partPath);
        return;
      }
      await fs.truncate(partPath, completedBytes);
    }
    await finalizeMp4Duration(partPath);
    await fs.rename(partPath, finalPath);
  } catch (error) {
    await fs.unlink(partPath).catch(() => {});
    throw error;
  }
}

async function handleMediaPost(req, res, url) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método não disponível.' });
    const id = queryValue(url, 'server');
    if (activeServerId !== id) throw new Error('Selecione novamente o servidor antes de continuar.');
    const config = await getConfig(id);
    const filename = queryValue(url, 'filename');
    const screenshot = url.pathname === '/api/media-file';
    const { folder, finalPath, partPath } = mediaTarget(config, filename, screenshot);
    await fs.mkdir(folder, { recursive: true });
    if (screenshot) {
      if ((req.headers['content-type'] || '').toLowerCase() !== 'image/png') throw new Error('O tipo de imagem enviado é inválido.');
      const temporaryPath = `${partPath}.${process.pid}`;
      try { await pipeline(req, createWriteStream(temporaryPath, { flags: 'wx' })); }
      catch (error) { await fs.unlink(temporaryPath).catch(() => {}); throw error; }
      if (await fs.stat(finalPath).then(() => true, () => false)) { await fs.unlink(temporaryPath).catch(() => {}); throw new Error('Já existe um arquivo com esse nome.'); }
      await fs.rename(temporaryPath, finalPath);
      return sendJson(res, 201, { filename });
    }
    if (url.pathname !== '/api/media-recording') return sendJson(res, 404, { error: 'Rota não encontrada.' });
    const action = queryValue(url, 'action');
    const key = `${id}\0${filename}`;
    if (action === 'start') {
      if (mediaWriters.has(key) || await fs.stat(partPath).then(() => true, () => false) || await fs.stat(finalPath).then(() => true, () => false)) throw new Error('Já existe uma gravação com esse nome.');
      const stream = createWriteStream(partPath, { flags: 'wx' });
      stream.on('error', () => { mediaWriters.delete(key); void fs.unlink(partPath).catch(() => {}); });
      try { await once(stream, 'open'); } catch (error) { throw new Error(`Não foi possível criar o arquivo de gravação: ${error.code || 'erro de escrita'}.`); }
      mediaWriters.set(key, { stream, partPath, finalPath, completedBytes: 0 });
      return sendJson(res, 201, { filename });
    }
    const writer = mediaWriters.get(key);
    if (!writer) throw new Error('A gravação local não está aberta.');
    if (action === 'chunk') {
      await writeRequestToStream(req, writer.stream);
      writer.completedBytes = writer.stream.bytesWritten;
      return sendJson(res, 200, { accepted: true });
    }
    if (action === 'abort') {
      mediaWriters.delete(key);
      const closed = writer.stream.closed ? Promise.resolve() : once(writer.stream, 'close').catch(() => {});
      writer.stream.destroy();
      await closed;
      await fs.unlink(writer.partPath).catch(() => {});
      return sendJson(res, 200, { discarded: true });
    }
    if (action !== 'finish') throw new Error('Ação de gravação inválida.');
    mediaWriters.delete(key);
    await finishRecording(writer);
    return sendJson(res, 201, { filename });
  } catch (error) {
    const message = error?.message && !/password|authdata|authsession|nonce/i.test(error.message) ? error.message : 'Não foi possível salvar a mídia local.';
    sendJson(res, 400, { error: message });
  }
}

function safeErrorCategory(error) {
  const message = String(error?.message ?? '');
  const transport = message.match(/^Falha de transporte na etapa ([a-zA-Z0-9_]+) \(([A-Z0-9_]+)\)\.?$/);
  if (transport) return `transport:${transport[1]}:${transport[2]}`;
  if (/arquivo de configuração não contém JSON válido/i.test(message)) return 'invalid-config-json';
  if (/configuração|fuso|initialCameras|initialMosaic|maxCams|seekSeconds/i.test(message)) return 'invalid-config';
  if (/servidor Digifort não aceitou/i.test(message)) return 'upstream-rejected';
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'request-timeout';
  return 'request-failed';
}

function queryValue(url, key, required = true) {
  const value = url.searchParams.get(key);
  if (required && !value) throw new Error(`Parâmetro ausente: ${key}.`);
  return value;
}

async function handleApi(req, res, url) {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    if (url.pathname === '/api/update/download' || url.pathname === '/api/update/apply') {
      if (req.headers.host !== `${HOST}:${PORT}` || (req.method !== 'GET' && req.headers.origin !== `http://${HOST}:${PORT}`)) return sendJson(res, 403, { error: 'Solicitação de outra origem.' });
      if (!updateCapable) return sendJson(res, 403, { error: 'Atualização disponível somente na instalação Windows.' });
      if (url.pathname.endsWith('/download') && req.method === 'GET') return sendJson(res, 200, updateDownload);
      if (url.pathname.endsWith('/download') && req.method === 'POST') {
        const update = await updateCheck;
        if (!update?.canInstall) return sendJson(res, 400, { error: 'Instalador ou checksum indisponível.' });
        if (updateDownload.status !== 'downloading' && updateDownload.status !== 'ready') { updateDownload = { status: 'downloading', received: 0, total: 0 }; void downloadUpdate(update); }
        return sendJson(res, 202, updateDownload);
      }
      if (url.pathname.endsWith('/apply') && req.method === 'POST' && updateDownload.status === 'ready' && updateInstaller) {
        updateDownload.status = 'applying';
        res.once('finish', () => process.stdout.write(`DIGIFORT_UPDATE:${Buffer.from(updateInstaller, 'utf8').toString('base64')}\n`));
        return sendJson(res, 202, { ok: true });
      }
      return sendJson(res, 400, { error: 'Atualização não está pronta.' });
    }
    if (url.pathname === '/api/update') {
      if (req.headers.host !== `${HOST}:${PORT}` || (req.method !== 'GET' && req.headers.origin !== `http://${HOST}:${PORT}`)) return sendJson(res, 403, { error: 'Solicitação de outra origem.' });
      if (req.method === 'GET') return sendJson(res, 200, { update: updateIgnored ? null : await updateCheck });
      if (req.method === 'POST') {
        const update = await updateCheck;
        if (update) {
          await fs.mkdir(CONFIG_DIR, { recursive: true });
          await fs.writeFile(UPDATE_FILE, JSON.stringify({ ignoredVersion: update.version }) + '\n');
          updateIgnored = true;
        }
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 405, { error: 'Método não disponível.' });
    }
    if (url.pathname === '/api/media-folder') {
      if (req.method !== 'POST' || req.headers.host !== `${HOST}:${PORT}` || req.headers.origin !== `http://${HOST}:${PORT}`) return sendJson(res, 403, { error: 'Solicitação de outra origem.' });
      const id = queryValue(url, 'server'), kind = queryValue(url, 'folder');
      if (!safeId(id) || !['screenshot', 'video'].includes(kind)) throw new Error('Pasta de mídia inválida.');
      const config = await getConfig(id);
      const folder = kind === 'screenshot' ? config.screenshotFolder : config.videoFolder;
      if (!folder) throw new Error('Pasta de mídia não configurada.');
      const executable = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const child = spawn(executable, [path.resolve(folder)], { detached: true, stdio: 'ignore', windowsHide: false });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && ['/api/media-file', '/api/media-recording'].includes(url.pathname)) {
      const pending = handleMediaPost(req, res, url);
      mediaRequests.add(pending);
      try { return await pending; } finally { mediaRequests.delete(pending); }
    }
    if (launcher && req.method === 'POST' && ['/api/config-folder', '/api/close-app'].includes(url.pathname)) {
      if (req.headers.origin !== `http://${HOST}:${PORT}` || req.headers.host !== `${HOST}:${PORT}`) {
        return sendJson(res, 403, { error: 'Solicitação de outra origem.' });
      }
      const command = url.pathname === '/api/config-folder' ? 'DIGIFORT_OPEN_CONFIG' : 'DIGIFORT_CLOSE_APP';
      return res.once('finish', () => process.stdout.write(`${command}\n`)).writeHead(204).end();
    }
    if (url.pathname === '/api/stream-channel') {
      if (req.method !== 'GET' || req.headers.host !== `${HOST}:${PORT}` || req.headers['sec-fetch-site'] !== 'same-origin') return sendJson(res, 403, { error: 'Solicitação de outra origem.' });
      const id = queryValue(url, 'server');
      if (activeServerId !== id) throw new Error('Selecione novamente o servidor antes de continuar.');
      const kind = queryValue(url, 'kind');
      if (!['stream', 'audio-stream'].includes(kind)) return sendJson(res, 400, { error: 'Tipo de transmissão inválido.' });
      const params = new URLSearchParams(url.searchParams);
      params.delete('kind');
      const channel = await createStreamChannel(kind, params);
      return sendJson(res, 200, channel);
    }
    if (url.pathname === '/api/grid') {
      if (req.headers.host !== `${HOST}:${PORT}` || req.headers.origin !== `http://${HOST}:${PORT}`) return sendJson(res, 403, { error: 'Solicitação de outra origem.' });
      if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Método não disponível.' });
      const id = queryValue(url, 'server');
      if (!safeId(id) || id.toLowerCase() === 'example' || activeServerId !== id) throw new Error('Selecione novamente o servidor antes de continuar.');
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 65536) throw new Error('Configuração muito grande.'); }
      let fields;
      try { fields = JSON.parse(body); } catch { throw new Error('Configuração JSON inválida.'); }
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !Object.hasOwn(fields, 'initialCameras') || !Object.hasOwn(fields, 'initialMosaic')) throw new Error('Configuração de grade inválida.');
      const previous = await readConfig(id);
      const value = { ...previous, initialCameras: fields.initialCameras, initialMosaic: fields.initialMosaic };
      const parsed = parseConfig(id, value);
      if (parsed.initialMosaic !== fields.initialMosaic) throw new Error('Configuração de grade inválida.');
      await fs.writeFile(path.join(CONFIG_DIR, `${id}.config`), JSON.stringify(value, null, 2) + '\n');
      configs.set(id, parsed);
      return sendJson(res, 200, { ok: true });
    }
    if (url.pathname === '/api/config') {
      if (req.headers.host !== `${HOST}:${PORT}` || (req.method !== 'GET' && req.headers.origin !== `http://${HOST}:${PORT}`)) return sendJson(res, 403, { error: 'Solicitação de outra origem.' });
      const id = queryValue(url, 'server');
      if (!safeId(id) || id.toLowerCase() === 'example') throw new Error('Identificador de configuração inválido.');
      const configPath = path.join(CONFIG_DIR, `${id}.config`);
      if (req.method === 'GET') {
        const value = await readConfig(id);
        const fields = Object.fromEntries(['name', 'serverAddress', 'userAgent', 'username', 'timeZone', 'mediaFolder', 'screenshotFolder', 'videoFolder', 'initialMosaic', 'maxCams', 'seekSeconds', 'useBasicAuth', 'initialCameras'].filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
        return sendJson(res, 200, { fields, hasPassword: typeof value.password === 'string' });
      }
      if (req.method === 'DELETE') {
        await fs.unlink(configPath);
        configs.delete(id);
        if (activeServerId === id) activateServer('');
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 65536) throw new Error('Configuração muito grande.');
        }
        let fields;
        try { fields = JSON.parse(body); } catch { throw new Error('Configuração JSON inválida.'); }
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Configuração inválida.');
        let previous = {};
        if (req.method === 'PUT') previous = await readConfig(id);
        const value = { ...previous, ...fields };
        if (!Object.hasOwn(fields, 'password')) value.password = previous.password;
        parseConfig(id, value);
        await fs.mkdir(CONFIG_DIR, { recursive: true });
        if (req.method === 'POST') await fs.writeFile(configPath, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
        else await fs.writeFile(configPath, JSON.stringify(value, null, 2) + '\n');
        configs.delete(id);
        if (activeServerId === id) activateServer('');
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 405, { error: 'Método não disponível.' });
    }
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método não disponível.' });
    if (url.pathname === '/api/servers') {
      return sendJson(res, 200, { servers: await serverOptions(), configDirectory: CONFIG_DIR, canOpenConfigFolder: launcher });
    }
    const id = queryValue(url, 'server');
    if (url.pathname === '/api/server') {
      const config = await getConfig(id);
      activateServer(id);
      return sendJson(res, 200, { id, name: config.name, timeZone: config.timeZone, initialCameras: config.initialCameras, initialMosaic: config.initialMosaic, maxCams: config.maxCams, seekSeconds: config.seekSeconds, screenshotFolderConfigured: Boolean(config.screenshotFolder), videoFolderConfigured: Boolean(config.videoFolder) });
    }
    if (activeServerId !== id) throw new Error('Selecione novamente o servidor antes de continuar.');
    const config = await getConfig(id);
    if (url.pathname === '/api/cameras') {
      return sendJson(res, 200, { cameras: await transport.cameras(id, config, controller.signal) });
    }
    if (url.pathname === '/api/camera-status') {
      return sendJson(res, 200, { statuses: await transport.statuses(id, config, controller.signal) });
    }
    if (url.pathname === '/api/timeline') {
      const camera = queryValue(url, 'camera');
      const startDate = queryValue(url, 'startDate');
      const startTime = queryValue(url, 'startTime');
      const endDate = queryValue(url, 'endDate', false);
      const endTime = queryValue(url, 'endTime', false);
      const response = await transport.request(id, config, 'Cameras/Playback/GetTimelineData', {
        Camera: camera, StartDate: startDate, StartTime: startTime,
        EndDate: endDate, EndTime: endTime, Video: 'TRUE', Audio: 'TRUE', Metadata: 'FALSE', ResponseFormat: 'Text'
      }, controller.signal);
      if (!response.ok || !response.body || !(response.headers.get('content-type') || '').toLowerCase().includes('multipart/')) throw new Error('Não foi possível carregar a timeline dessa câmera. Verifique acesso e período selecionado.');
      res.writeHead(200, { 'Content-Type': response.headers.get('content-type') || 'multipart/x-mixed-replace', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      for await (const chunk of response.body) {
        if (!res.write(Buffer.from(chunk))) await new Promise(resolve => res.once('drain', resolve));
      }
      return res.end();
    }
    if (url.pathname === '/api/snapshot') {
      const snapshotSizes = { '38x26': ['38', '26'], '150x103': ['150', '103'], '75x51': ['75', '51'], '150x102': ['150', '102'], '300x205': ['300', '205'], '352x240': ['352', '240'] };
      const requested = `${queryValue(url, 'width') || '352'}x${queryValue(url, 'height') || '240'}`;
      const [width, height] = snapshotSizes[requested] || snapshotSizes['352x240'];
      const response = await transport.request(id, config, 'Cameras/Playback/GetSnapshot', {
        Camera: queryValue(url, 'camera'), Date: queryValue(url, 'date'), Time: queryValue(url, 'time'),
        Width: width, Height: height, KeepAspectRatio: 'TRUE', Quality: '55', ResponseFormat: 'Text'
      }, controller.signal);
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.toLowerCase().includes('image/jpeg')) throw new Error('Não há imagem gravada nesse instante.');
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      await response.body.pipeTo(WritableStreamFromServerResponse(res));
      return;
    }
    if (url.pathname === '/api/stream' || url.pathname === '/api/audio-stream') {
      const audioOnly = url.pathname === '/api/audio-stream';
      const mode = queryValue(url, 'mode');
      const camera = queryValue(url, 'camera');
      const audio = audioOnly || queryValue(url, 'audio', false) === '1';
      let response;
      if (mode === 'live') {
        const profile = queryValue(url, 'profile', false) || 'Visualization';
        if (!['Visualization', 'Recording'].includes(profile)) throw new Error('Perfil ao vivo inválido.');
        response = await transport.request(id, config, 'Cameras/GetMediaStream', {
          Camera: camera, Profile: profile, Audio: audio ? 'TRUE' : 'FALSE', Video: audioOnly ? 'FALSE' : 'TRUE', TimestampHeader: 'TRUE', ResponseFormat: 'Text'
        }, controller.signal);
      } else if (mode === 'playback') {
        response = await transport.request(id, config, 'Cameras/Playback/GetMediaStream', {
          Camera: camera, StartDate: queryValue(url, 'startDate'), StartTime: queryValue(url, 'startTime'),
          EndDate: queryValue(url, 'endDate', false), EndTime: queryValue(url, 'endTime', false),
          Audio: audio ? 'TRUE' : 'FALSE', Push: 'FALSE', ResponseFormat: 'Text'
        }, controller.signal);
      } else {
        throw new Error('Modo de reprodução inválido.');
      }
      if (!response.ok || !response.body || !(response.headers.get('content-type') || '').toLowerCase().includes('multipart/')) throw new Error('Não foi possível abrir o stream da câmera. Verifique acesso e perfil selecionado.');
      res.writeHead(200, { 'Content-Type': response.headers.get('content-type') || 'multipart/x-mixed-replace; boundary=--DigifortBoundary', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      for await (const chunk of response.body) {
        if (!res.write(Buffer.from(chunk))) await new Promise(resolve => res.once('drain', resolve));
      }
      return res.end();
    }
    return sendJson(res, 404, { error: 'Rota não encontrada.' });
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const message = error?.message && !/password|authdata|authsession|nonce|http[s]?:\/\//i.test(error.message)
      ? error.message
      : 'Não foi possível concluir a solicitação. Revise a conexão e a configuração local.';
    const status = /configuração|fuso|initialCameras|initialMosaic|maxCams|seekSeconds|parâmetro|perfil/i.test(message) ? 400 : 502;
    process.stderr.write(`[api:error] ${req.method} ${url.pathname} ${status} ${safeErrorCategory(error)}\n`);
    sendJson(res, status, { error: message });
  }
}

function WritableStreamFromServerResponse(res) {
  return new WritableStream({
    write(chunk) {
      if (!res.write(Buffer.from(chunk))) return new Promise(resolve => res.once('drain', resolve));
    },
    close() { res.end(); },
    abort() { res.destroy(); }
  });
}

async function createStreamChannel(kind, params) {
  const token = randomBytes(24).toString('hex');
  const origin = `http://${HOST}:${PORT}`;
  let timer;
  const channel = createServer((req, res) => {
    if (req.method !== 'GET' || req.headers.origin !== origin || req.url !== `/${token}` || req.headers.host !== `${HOST}:${channel.address()?.port}`) {
      res.writeHead(403).end();
      return;
    }
    clearTimeout(timer);
    channel.close();
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    const target = new URL(`/api/${kind}?${params}`, origin);
    void handleApi(req, res, target);
  });
  streamChannels.add(channel);
  channel.once('close', () => { clearTimeout(timer); streamChannels.delete(channel); });
  try {
    await new Promise((resolve, reject) => { channel.once('error', reject); channel.listen(0, HOST, resolve); });
    timer = setTimeout(() => channel.close(), 15000);
    timer.unref();
    return { port: channel.address().port, token };
  } catch (error) {
    streamChannels.delete(channel);
    throw error;
  }
}

function staticFile(res, pathname) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  let decodedPath;
  try { decodedPath = decodeURIComponent(normalized); }
  catch { return sendJson(res, 400, { error: 'Caminho inválido.' }); }
  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return sendJson(res, 404, { error: 'Arquivo não encontrado.' });
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
  fs.stat(filePath).then(stat => {
    if (!stat.isFile()) return sendJson(res, 404, { error: 'Arquivo não encontrado.' });
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' http://127.0.0.1:*; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
    });
    createReadStream(filePath).pipe(res);
  }).catch(() => sendJson(res, 404, { error: 'Arquivo não encontrado.' }));
}

const server = createServer((req, res) => {
  if (shuttingDown) return sendJson(res, 503, { error: 'Encerrando o Digifort Monitor.' });
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    void handleApi(req, res, url);
    return;
  }
  staticFile(res, url.pathname);
});

server.once('error', error => {
  if (launcher && error.code === 'EADDRINUSE') process.stdout.write('DIGIFORT_PORT_IN_USE\n');
  process.stderr.write(`Falha ao escutar em ${HOST}:${PORT} (${error.code || 'erro de inicialização'}).\n`);
  process.exitCode = 1;
  process.stdin.destroy();
});

server.listen(PORT, HOST, () => {
  if (launcher) process.stdout.write('DIGIFORT_READY\n');
  process.stdout.write(`Player local disponível em http://${HOST}:${PORT}\n`);
});

if (launcher) {
  const control = createInterface({ input: process.stdin, terminal: false });
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    // Give a pending media upload a brief chance to drain before closing streams.
    const pendingMedia = Promise.allSettled(mediaRequests);
    await Promise.race([pendingMedia, delay(750)]);
    server.closeAllConnections();
    for (const channel of streamChannels) { channel.close(); channel.closeAllConnections(); }
    await pendingMedia;
    await Promise.allSettled([...mediaWriters.values()].map(writer => finishRecording(writer, true)));
    process.exit(process.exitCode || 0);
  };
  control.on('line', line => { if (line === 'shutdown') void shutdown(); else if (line === 'update-failed') updateDownload = { status: 'error', error: 'Não foi possível iniciar o instalador. Tente novamente.' }; });
  control.on('close', () => { if (server.listening) void shutdown(); });
}
