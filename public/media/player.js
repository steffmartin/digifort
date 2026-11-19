let g726ModulePromise;

function loadG726Decoder() {
  if (!g726ModulePromise) {
    g726ModulePromise = import('/wasm/digifort_g726_wasm.js')
      .then(async module => { await module.default(); return module.G726Decoder; })
      .catch(error => { g726ModulePromise = null; throw error; });
  }
  return g726ModulePromise;
}

function getG726Config(headers, type) {
  const hint = [type, headers['content-type'], headers['dgf-frametype'], headers['dgf-codec'], headers['dgf-audioformat'], headers['dgf-audiocodec']]
    .filter(Boolean).join(' ').toLowerCase();
  const headerRate = [headers['dgf-bitrate'], headers['dgf-audio-bitrate'], headers['bitrate']]
    .find(value => value !== undefined)?.match(/(?:16|24|32|40)(?:000)?/);
  const namedRate = hint.match(/g\.?726(?:[-_/ ]?(16|24|32|40))|\b(16|24|32|40)\s*(?:kbps|kbit(?:s|\/s)?)/i);
  const parsedRate = Number(headerRate?.[0]?.replace(/000$/, '') || namedRate?.[1] || namedRate?.[2]);
  const rate = [16, 24, 32, 40].includes(parsedRate) ? parsedRate : null;
  const orderHint = [headers['dgf-bitorder'], headers['dgf-audio-bit-order'], headers['bit-order'], headers['bitorder'], hint]
    .filter(Boolean).join(' ').toLowerCase();
  const explicitOrder = /\b(?:lsb|little[- ]?endian|le)\b/.test(orderHint) ? 'lsb'
    : /\b(?:msb|big[- ]?endian|be)\b/.test(orderHint) ? 'msb' : null;
  // The Digifort MIME does not carry packing order; RFC 3551 defines the canonical G.726 payload as LSB-first.
  return { rate, bitOrder: explicitOrder || 'lsb', assumedBitOrder: !explicitOrder };
}

export function createCameraPlayerClass({ state, query, epochToApi, parseFrameEpoch, toast, presenceAlarm, updateTimelinePlayhead }) {
async function openMediaStream(kind, params, signal) {
  const response = await fetch(`/api/stream-channel?${query({ ...params, kind })}`, { signal, cache: 'no-store' });
  if (!response.ok) {
    let message = 'Não foi possível abrir a transmissão.';
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  const channel = await response.json();
  if (!Number.isInteger(channel.port) || channel.port < 1 || channel.port > 65535 || !/^[a-f0-9]{48}$/.test(channel.token)) throw new Error('Canal de transmissão inválido.');
  return fetch(`http://127.0.0.1:${channel.port}/${channel.token}`, { signal, cache: 'no-store' });
}

class CameraPlayer {
  constructor(name, tile, profile) {
    this.name = name;
    this.tile = tile;
    this.canvas = tile.querySelector('canvas');
    this.context = this.canvas.getContext('2d', { alpha: false });
    this.profile = profile;
    this.lastLiveProfile = profile;
    this.abortController = null;
    this.videoDecoder = null;
    this.videoCodec = '';
    this.videoDecoderGeneration = 0;
    this.activeVideoCodec = '';
    this.videoCodecEpoch = 0;
    this.hevcParameterSets = new Map();
    this.hevcHasRandomAccess = false;
    this.hevcDecodeChain = Promise.resolve();
    this.audioDecoder = null;
    this.g726 = null;
    this.g726Config = null;
    this.g726DecodeChain = Promise.resolve();
    this.audioAbortController = null;
    this.audioStreamToken = 0;
    this.requestToken = 0;
    this.videoEpoch = null;
    this.audioEpoch = null;
    this.frameCount = 0;
    this.audioCount = 0;
    this.stopped = false;
    this.retryTimer = null;
    this.retryDelay = 0;
    this.presenceFrameAt = 0;
  }

  async start() {
    this.stopped = false;
    const token = ++this.requestToken;
    this.abortController = new AbortController();
    const params = {
      server: state.serverId, camera: this.name, mode: state.mode,
      profile: state.mode === 'live' ? this.profile : undefined,
      audio: '0'
    };
    if (state.mode === 'playback') {
      if (!state.reviewStart) {
        this.setMessage('Informe o horário e selecione Reproduzir.');
        return;
      }
      const start = epochToApi(state.reviewEpoch ?? state.reviewStart, state.server.timeZone);
      const end = state.reviewEnd ? epochToApi(state.reviewEnd, state.server.timeZone) : null;
      Object.assign(params, { startDate: start.date, startTime: start.time, endDate: end?.date, endTime: end?.time });
    }
    this.setState(state.mode === 'live' ? 'Ao vivo' : 'Gravado');
    this.setMessage('Conectando ao stream…');
    try {
      const response = await openMediaStream('stream', params, this.abortController.signal);
      if (token !== this.requestToken) return;
      if (!response.ok) {
        let message = 'Não foi possível abrir esta câmera.';
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
      }
      this.setMessage('Recebendo mídia…');
      void consumeMultipart(response, part => {
        if (!this.stopped && token === this.requestToken) this.consumePart(part);
      }).then(() => {
        if (!this.stopped && token === this.requestToken) this.retryStream(token);
      }).catch(error => {
        if (error.name === 'AbortError' || this.stopped || token !== this.requestToken) return;
        this.retryStream(token);
      });
      if (state.audioEnabled && state.focused === this.name) void this.startAudioStream();
    } catch (error) {
      if (error.name === 'AbortError' || this.stopped || token !== this.requestToken) return;
      this.retryStream(token);
    }
  }

  retryStream(token) {
    if (this.stopped || token !== this.requestToken) return;
    const wasReceiving = this.presenceFrameAt;
    this.presenceFrameAt = 0;
    presenceAlarm.streamUnavailable(this.name, wasReceiving);
    if (state.mode !== 'live') {
      this.setMessage('O servidor encerrou o stream.');
      this.setState('Erro');
      return;
    }
    if (this.retryDelay > 300000) {
      this.setMessage('Não foi possível reconectar. Reinicie a câmera para tentar novamente.');
      this.setState('Erro');
      return;
    }
    const delay = this.retryDelay;
    this.retryDelay = delay === 0 ? 1000 : delay === 300000 ? 300001 : Math.min(delay * 2, 300000);
    this.setMessage(delay ? `Reconectando em ${Math.ceil(delay / 1000)} s…` : 'Reconectando ao stream…');
    this.setState('Reconectando');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.stopped || token !== this.requestToken) return;
      const nextDelay = this.retryDelay;
      this.stop(false);
      this.retryDelay = nextDelay;
      void this.start();
    }, delay);
  }

  async restart() {
    if (state.mode === 'live') this.lastLiveProfile = this.profile;
    this.stop(false);
    await this.start();
  }

  async startAudioStream() {
    this.stopAudioStream();
    if (this.stopped || state.allStopped || !state.audioEnabled || state.focused !== this.name) return;
    if (state.mode === 'playback' && !state.reviewStart) return;
    const token = ++this.audioStreamToken;
    const controller = new AbortController();
    this.audioAbortController = controller;
    const params = { server: state.serverId, camera: this.name, mode: state.mode, audioOnly: '1' };
    if (state.mode === 'live') params.profile = this.profile;
    else if (state.mode === 'playback') {
      const start = epochToApi(state.reviewEpoch ?? state.reviewStart, state.server.timeZone);
      const end = state.reviewEnd ? epochToApi(state.reviewEnd, state.server.timeZone) : null;
      Object.assign(params, { startDate: start.date, startTime: start.time, endDate: end?.date, endTime: end?.time });
    }
    try {
      const response = await openMediaStream('audio-stream', params, controller.signal);
      if (token !== this.audioStreamToken || !state.audioEnabled || state.focused !== this.name) return;
      if (!response.ok || !response.body || !(response.headers.get('content-type') || '').toLowerCase().includes('multipart/')) {
        let message = 'Não foi possível abrir o áudio desta câmera.';
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
      }
      void consumeMultipart(response, part => {
        if (token === this.audioStreamToken && state.audioEnabled && state.focused === this.name) this.consumePart(part, true);
      }).catch(error => {
        if (error.name === 'AbortError' || token !== this.audioStreamToken || !state.audioEnabled || state.focused !== this.name) return;
        this.setMessage(error.message || 'Erro ao receber áudio.');
      });
    } catch (error) {
      if (error.name === 'AbortError' || token !== this.audioStreamToken || !state.audioEnabled || state.focused !== this.name) return;
      this.setMessage(error.message || 'Não foi possível abrir o áudio desta câmera.');
    }
  }

  stopAudioStream() {
    this.audioStreamToken += 1;
    this.audioAbortController?.abort();
    this.audioAbortController = null;
    try { this.audioDecoder?.close(); } catch {}
    this.audioDecoder = null;
    try { this.g726?.free(); } catch {}
    this.g726 = null;
    this.g726Config = null;
    this.g726DecodeChain = Promise.resolve();
  }

  stop(clear = true) {
    this.stopped = true;
    this.presenceFrameAt = 0;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryDelay = 0;
    this.requestToken += 1;
    this.stopAudioStream();
    this.abortController?.abort();
    this.abortController = null;
    this.clearVideoDecoder();
    this.activeVideoCodec = '';
    this.videoCodecEpoch += 1;
    try { this.audioDecoder?.close(); } catch {}
    try { this.g726?.free(); } catch {}
    this.hevcParameterSets.clear();
    this.hevcDecodeChain = Promise.resolve();
    this.audioDecoder = null;
    this.g726 = null;
    this.g726Config = null;
    this.videoEpoch = null;
    this.audioEpoch = null;
    if (clear && this.context) this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  setState(label) {
    const recording = state.recordings.get(this.name);
    const base = state.mode === 'live' ? 'Ao vivo' : 'Gravado';
    if (recording?.status === 'recording') label = `${base} (capturando)`;
    else if (recording?.status === 'paused') label = `${base} (pausado)`;
    this.tile.querySelector('.tile-state-text').textContent = label;
  }
  setMessage(message) {
    const node = this.tile.querySelector('.tile-message');
    node.textContent = message;
    node.hidden = !message;
  }

  consumePart(part, audioOnly = false) {
    const type = `${part.headers['dgf-frametype'] || ''} ${part.headers['content-type'] || ''}`.toLowerCase();
    if (audioOnly && !/audio|g\.?726|alaw|mulaw|ulaw/i.test(type)) return;
    if (!audioOnly && /jpeg|h\.?264|h\.?265|hevc/i.test(type)) { this.retryDelay = 0; this.presenceFrameAt = Date.now(); }
    const epoch = parseFrameEpoch(part.headers);
    if (state.mode === 'playback' && this.name === state.focused && epoch !== null) updateTimelinePlayhead(epoch);
    if (epoch) this.tile.querySelector('.tile-timecode').textContent = new Intl.DateTimeFormat('pt-BR', { timeZone: state.server.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(epoch);
    if (type.includes('jpeg') || part.headers['content-type']?.toLowerCase().includes('image/jpeg')) {
      this.drawJpeg(part.data);
      this.frameCount += 1;
      this.setMessage('');
      this.setState(state.mode === 'live' ? 'Ao vivo' : 'Gravado');
      return;
    }
    if (type.includes('h.264') || type.includes('h264') || part.headers['content-type']?.toLowerCase().includes('video/h264')) {
      this.decodeH264(part.data, type.includes('i-frame') || type.includes('iframe'), epoch);
      return;
    }
    if (type.includes('h.265') || type.includes('h265') || type.includes('hevc')) {
      this.decodeH265(part.data, type, epoch);
      return;
    }
    if (/g\.?726/i.test(type)) {
      if (state.audioEnabled && state.focused === this.name) this.decodeG726(part.data, type, epoch, part.headers);
      return;
    }
    if (type.includes('audio/basic') || type.includes('audio/alaw') || type.includes('audio/mulaw') || type.includes('audio/ulaw')) {
      if (state.audioEnabled && state.focused === this.name) this.decodeWebAudio(part.data, type, epoch);
      return;
    }
    if (type.includes('audio/aac')) {
      if (state.audioEnabled && state.focused === this.name) this.decodeAac(part.data, epoch);
      return;
    }
    if (type.startsWith('audio/')) {
      this.setMessage(`Codec de áudio não suportado: ${part.headers['content-type'] || type}`);
      this.setState('Codec incompatível');
      return;
    }
    if (type.startsWith('video/')) {
      this.setMessage(`Codec de vídeo não suportado: ${part.headers['content-type'] || type}`);
      this.setState('Codec incompatível');
    }
  }

  async drawJpeg(data) {
    try {
      const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
      if (this.stopped) { bitmap.close(); return; }
      this.canvas.width = bitmap.width;
      this.canvas.height = bitmap.height;
      this.context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
      bitmap.close();
    } catch {
      this.setMessage('Não foi possível decodificar o quadro JPEG.');
    }
  }

  decodeH264(data, keyFrame, epoch) {
    if (typeof VideoDecoder !== 'function' || typeof EncodedVideoChunk !== 'function') {
      this.setMessage('Este navegador não oferece WebCodecs de vídeo. Use uma versão atual do Chromium ou Edge.');
      this.setState('Navegador incompatível');
      return;
    }
    if (this.activeVideoCodec !== 'h264') {
      this.clearVideoDecoder();
      this.hevcParameterSets.clear();
      this.activeVideoCodec = 'h264';
      this.videoCodecEpoch += 1;
    }
    const bytes = normalizeAnnexB(data);
    const sps = findNal(bytes, 7);
    if (!this.videoDecoder && sps && sps.length >= 4) {
      const codec = `avc1.${[sps[1], sps[2], sps[3]].map(value => value.toString(16).padStart(2, '0')).join('')}`;
      this.videoDecoder = this.createVideoDecoder(codec, 'H.264', this.requestToken);
      try { this.videoDecoder.configure({ codec, optimizeForLatency: true }); this.videoCodec = codec; }
      catch {
        this.clearVideoDecoder();
        this.setMessage('Perfil H.264 indisponível neste navegador.');
        this.setState('Codec incompatível');
        return;
      }
    }
    if (!this.videoDecoder || this.videoDecoder.state !== 'configured') {
      if (!sps) this.setMessage('Aguardando quadro-chave com parâmetros H.264.');
      return;
    }
    const timestamp = this.mediaTimestamp(epoch, 'video');
    try {
      if (this.videoDecoder.decodeQueueSize < 14) this.videoDecoder.decode(new EncodedVideoChunk({ type: keyFrame ? 'key' : 'delta', timestamp, data: bytes }));
    } catch { this.setMessage('Quadro H.264 inválido recebido do stream.'); }
  }

  decodeH265(data, type, epoch) {
    if (typeof VideoDecoder !== 'function' || typeof EncodedVideoChunk !== 'function') {
      this.setMessage('Este navegador não oferece WebCodecs de vídeo. Use uma versão atual do Chromium ou Edge.');
      this.setState('Navegador incompatível');
      return;
    }
    const token = this.requestToken;
    if (this.activeVideoCodec !== 'h265') {
      this.clearVideoDecoder();
      this.hevcParameterSets.clear();
      this.activeVideoCodec = 'h265';
      this.videoCodecEpoch += 1;
    }
    const codecEpoch = this.videoCodecEpoch;
    this.hevcDecodeChain = this.hevcDecodeChain.then(async () => {
      if (this.stopped || token !== this.requestToken || codecEpoch !== this.videoCodecEpoch) return;
      await this.processH265(data, type, epoch, token, codecEpoch);
    }).catch(() => {
      if (!this.stopped && token === this.requestToken && codecEpoch === this.videoCodecEpoch) {
        this.setMessage('Não foi possível preparar ou decodificar o frame H.265 recebido.');
        this.setState('Codec incompatível');
      }
    });
  }

  async processH265(data, type, epoch, token, codecEpoch) {
    const bytes = normalizeHevcAnnexB(data);
    const nals = splitAnnexBNals(bytes);
    for (const nal of nals) {
      const nalType = (nal[0] >> 1) & 0x3f;
      if (nalType >= 32 && nalType <= 34) this.hevcParameterSets.set(nalType, nal);
    }

    const sps = this.hevcParameterSets.get(33);
    const randomAccess = nals.some(nal => {
      const nalType = (nal[0] >> 1) & 0x3f;
      return nalType >= 16 && nalType <= 21;
    });
    if (!sps) {
      this.setMessage('Os frames recebidos não contêm um SPS H.265 válido em formato Annex B.');
      this.setState('Aguardando H.265');
      return;
    }

    let codec;
    try { codec = hevcCodecString(sps); }
    catch {
      this.setMessage('Não foi possível identificar o perfil e nível do stream H.265.');
      this.setState('Codec incompatível');
      return;
    }

    const keyFrame = randomAccess;
    if (!this.hevcHasRandomAccess && !keyFrame) {
      this.setMessage('Aguardando um quadro-chave H.265 (IDR, CRA ou BLA).');
      this.setState('Aguardando H.265');
      return;
    }

    if (!this.videoDecoder) {
      const missing = [32, 33, 34].filter(nalType => !this.hevcParameterSets.has(nalType));
      if (missing.length) {
        this.setMessage(`Aguardando parâmetros H.265 necessários (NAL ${missing.join(', ')}).`);
        this.setState('Aguardando H.265');
        return;
      }
      const config = await VideoDecoder.isConfigSupported({ codec, optimizeForLatency: true });
      if (this.stopped || token !== this.requestToken || codecEpoch !== this.videoCodecEpoch) return;
      if (!config.supported) {
        this.setMessage(`Este navegador não suporta o perfil H.265 ${codec}.`);
        this.setState('Codec incompatível');
        return;
      }
      this.videoDecoder = this.createVideoDecoder(codec, 'H.265', token);
      this.videoCodec = codec;
      try { this.videoDecoder.configure(config.config); }
      catch {
        try { this.videoDecoder.close(); } catch {}
        this.videoDecoder = null;
        this.videoCodec = '';
        this.setMessage(`Não foi possível configurar o decoder H.265 ${codec}.`);
        this.setState('Codec incompatível');
        return;
      }
    } else if (this.videoCodec !== codec) {
      this.setMessage('O perfil H.265 mudou durante o stream; reinicie a câmera para reconfigurar o decoder.');
      this.setState('Codec incompatível');
      return;
    }

    let accessUnit = bytes;
    if (keyFrame) accessUnit = prependMissingHevcParameterSets(bytes, nals, this.hevcParameterSets);
    const timestamp = this.mediaTimestamp(epoch, 'video');
    try {
      if (this.videoDecoder.decodeQueueSize < 14) {
        this.videoDecoder.decode(new EncodedVideoChunk({ type: keyFrame ? 'key' : 'delta', timestamp, data: accessUnit }));
        if (keyFrame) this.hevcHasRandomAccess = true;
      }
    } catch {
      this.hevcHasRandomAccess = false;
      this.setMessage('O navegador rejeitou um frame H.265. Verifique o formato do stream e os parâmetros VPS/SPS/PPS.');
      this.setState('Codec incompatível');
    }
  }

  createVideoDecoder(codec, label, token) {
    const generation = ++this.videoDecoderGeneration;
    return new VideoDecoder({
      output: frame => {
        if (this.stopped || token !== this.requestToken || generation !== this.videoDecoderGeneration) { frame.close(); return; }
        if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
          this.canvas.width = frame.displayWidth;
          this.canvas.height = frame.displayHeight;
        }
        this.context.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
        frame.close();
        this.frameCount += 1;
        this.setMessage('');
        this.setState(state.mode === 'live' ? 'Ao vivo' : 'Gravado');
        this.tile.querySelector('.tile-codec').textContent = codec.toUpperCase();
      },
      error: () => {
        if (this.stopped || token !== this.requestToken || generation !== this.videoDecoderGeneration) return;
        this.clearVideoDecoder();
        this.setMessage(`O navegador não conseguiu decodificar o perfil ${label} desta câmera.`);
        this.setState('Codec incompatível');
      }
    });
  }

  clearVideoDecoder() {
    this.videoDecoderGeneration += 1;
    try { this.videoDecoder?.close(); } catch {}
    this.videoDecoder = null;
    this.videoCodec = '';
    this.hevcHasRandomAccess = false;
  }

  mediaTimestamp(epoch, kind) {
    if (epoch === null) return kind === 'video' ? (this.frameCount * 40000) : (this.audioCount * 20000);
    let base = kind === 'video' ? this.videoEpoch : this.audioEpoch;
    if (base === null) {
      base = state.mode === 'playback' && state.reviewStart ? (state.reviewEpoch ?? state.reviewStart) : epoch;
      if (kind === 'video') this.videoEpoch = base; else this.audioEpoch = base;
    }
    return Math.max(0, Math.round((epoch - base) * 1000));
  }

  async getAudioDecoder(codec, sampleRate, channels, description) {
    if (this.audioDecoder?.state === 'configured') return this.audioDecoder;
    if (typeof AudioDecoder !== 'function') throw new Error('Este navegador não oferece WebCodecs de áudio.');
    this.audioDecoder = new AudioDecoder({
      output: audioData => this.scheduleAudio(audioData),
      error: () => this.setMessage('O navegador não conseguiu decodificar o áudio recebido.')
    });
    const config = { codec, sampleRate, numberOfChannels: channels };
    if (description) config.description = description;
    const support = await AudioDecoder.isConfigSupported(config);
    if (!support.supported) { this.audioDecoder.close(); this.audioDecoder = null; throw new Error(`O navegador não suporta o áudio ${codec}.`); }
    this.audioDecoder.configure(config);
    return this.audioDecoder;
  }

  async decodeWebAudio(data, type, epoch) {
    const codec = type.includes('alaw') ? 'alaw' : 'ulaw';
    try {
      const decoder = await this.getAudioDecoder(codec, 8000, 1);
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: this.mediaTimestamp(epoch, 'audio'), data }));
      this.audioCount += 1;
    } catch (error) {
      this.setMessage(error.message || 'Áudio G.711 indisponível.');
    }
  }

  async decodeAac(data, epoch) {
    try {
      const parsed = parseAdts(data);
      const payload = parsed ? parsed.payload : data;
      const decoder = await this.getAudioDecoder('mp4a.40.2', parsed?.sampleRate || 48000, parsed?.channels || 2, parsed?.description);
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: this.mediaTimestamp(epoch, 'audio'), data: payload }));
      this.audioCount += 1;
    } catch (error) { this.setMessage(error.message || 'Áudio AAC indisponível.'); }
  }

  decodeG726(data, type, epoch, headers) {
    const bytes = data.slice();
    const token = this.requestToken;
    const audioToken = this.audioStreamToken;
    const config = getG726Config(headers, type);
    this.g726DecodeChain = this.g726DecodeChain.then(async () => {
      if (this.stopped || token !== this.requestToken || audioToken !== this.audioStreamToken || !state.audioEnabled || state.focused !== this.name) return;
      if (!config.rate) {
        this.setMessage('O frame G.726 não informa uma taxa reconhecida (16, 24, 32 ou 40 kb/s).');
        this.setState('Taxa G.726 desconhecida');
        return;
      }
      const Decoder = await loadG726Decoder();
      if (this.stopped || token !== this.requestToken || audioToken !== this.audioStreamToken || !state.audioEnabled || state.focused !== this.name) return;
      if (!this.g726 || this.g726Config?.rate !== config.rate || this.g726Config?.bitOrder !== config.bitOrder) {
        try { this.g726?.free(); } catch {}
        this.g726 = new Decoder(config.rate, config.bitOrder);
        this.g726Config = config;
      }
      const samples = this.g726.decode(bytes);
      const pcm = new Float32Array(samples.length);
      for (let index = 0; index < samples.length; index += 1) pcm[index] = samples[index] / 32768;
      this.schedulePcm(pcm, 8000, 1, this.mediaTimestamp(epoch, 'audio'));
      this.audioCount += 1;
      this.setMessage('');
      this.setState(state.mode === 'live' ? 'Ao vivo' : 'Gravado');
      this.tile.querySelector('.tile-codec').textContent = `G.726 ${config.rate} kb/s · ${config.bitOrder.toUpperCase()}${config.assumedBitOrder ? ' (RFC 3551)' : ''}`;
    }).catch(() => {
      if (this.stopped || token !== this.requestToken) return;
      this.setMessage('Não foi possível carregar ou decodificar o módulo G.726 local.');
      this.setState('Decoder G.726 indisponível');
    });
  }

  scheduleAudio(audioData) {
    try {
      const channels = audioData.numberOfChannels;
      const frames = audioData.numberOfFrames;
      const pcm = new Float32Array(frames * channels);
      for (let channel = 0; channel < channels; channel += 1) {
        const plane = new Float32Array(frames);
        audioData.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
        for (let index = 0; index < frames; index += 1) pcm[index * channels + channel] = plane[index];
      }
      this.schedulePcm(pcm, audioData.sampleRate, channels, audioData.timestamp);
    } catch {} finally { audioData.close(); }
  }

  schedulePcm(pcm, sampleRate, channels, timestampUs) {
    if (!state.audioContext || !state.audioEnabled || state.focused !== this.name) return;
    try {
      const ctx = state.audioContext;
      const frames = Math.floor(pcm.length / channels);
      if (!frames) return;
      const buffer = ctx.createBuffer(channels, frames, sampleRate);
      for (let channel = 0; channel < channels; channel += 1) {
        const plane = buffer.getChannelData(channel);
        for (let index = 0; index < frames; index += 1) plane[index] = pcm[index * channels + channel] ?? 0;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const relativeSeconds = typeof timestampUs === 'number' ? Math.max(0, timestampUs / 1e6) : 0;
      const startAt = Math.max(ctx.currentTime + 0.02, (state.audioContextStart || ctx.currentTime) + relativeSeconds);
      source.start(startAt);
      for (const recording of state.recordings.values()) {
        if (recording.camera === this.name && recording.destination) source.connect(recording.destination);
      }
    } catch {}
  }
}


return CameraPlayer;
}

function findNal(bytes, wantedType) {
  for (let i = 0; i + 4 < bytes.length; i += 1) {
    let start = -1;
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) start = i + 3;
    else if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1) start = i + 4;
    if (start < 0 || start >= bytes.length) continue;
    if ((bytes[start] & 0x1f) !== wantedType) continue;
    let end = bytes.length;
    for (let j = start + 1; j + 3 < bytes.length; j += 1) {
      if (bytes[j] === 0 && bytes[j + 1] === 0 && (bytes[j + 2] === 1 || (bytes[j + 2] === 0 && bytes[j + 3] === 1))) { end = j; break; }
    }
    return bytes.subarray(start, end);
  }
  return null;
}

function normalizeAnnexB(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  for (let i = 0; i + 3 < bytes.length; i += 1) if (bytes[i] === 0 && bytes[i + 1] === 0 && (bytes[i + 2] === 1 || (bytes[i + 2] === 0 && bytes[i + 3] === 1))) return bytes;
  const prefix = new Uint8Array([0, 0, 0, 1]);
  const normalized = new Uint8Array(prefix.length + bytes.length);
  normalized.set(prefix); normalized.set(bytes, prefix.length);
  return normalized;
}

function splitAnnexBNals(bytes) {
  const starts = [];
  for (let i = 0; i + 2 < bytes.length;) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      starts.push({ start: i, data: i + 3 });
      i += 3;
    } else if (i + 3 < bytes.length && bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1) {
      starts.push({ start: i, data: i + 4 });
      i += 4;
    } else i += 1;
  }
  return starts.map((start, index) => {
    const end = starts[index + 1]?.start ?? bytes.length;
    let trimmedEnd = end;
    while (trimmedEnd > start.data && bytes[trimmedEnd - 1] === 0) trimmedEnd -= 1;
    return bytes.subarray(start.data, trimmedEnd);
  }).filter(nal => nal.length >= 2);
}

function normalizeHevcAnnexB(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  for (let i = 0; i + 3 < bytes.length; i += 1) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && (bytes[i + 2] === 1 || (bytes[i + 2] === 0 && bytes[i + 3] === 1))) return bytes;
  }
  const nals = [];
  let offset = 0;
  let lengthPrefixed = bytes.length >= 6 && bytes[0] === 0 && bytes[1] === 0;
  while (lengthPrefixed && offset + 4 <= bytes.length) {
    const length = bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
    offset += 4;
    if (!length || offset + length > bytes.length) { lengthPrefixed = false; break; }
    nals.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  if (lengthPrefixed && nals.length && offset === bytes.length) {
    const result = new Uint8Array(nals.reduce((total, nal) => total + 4 + nal.length, 0));
    let cursor = 0;
    for (const nal of nals) {
      result.set([0, 0, 0, 1], cursor);
      cursor += 4;
      result.set(nal, cursor);
      cursor += nal.length;
    }
    return result;
  }
  return normalizeAnnexB(bytes);
}

function hevcCodecString(sps) {
  if (sps.length < 4 || ((sps[0] >> 1) & 0x3f) !== 33 || (sps[0] & 0x80) !== 0 || (sps[1] & 0x07) === 0) throw new Error('Invalid HEVC SPS');
  const rbsp = [];
  let zeros = 0;
  for (const value of sps.subarray(2)) {
    if (zeros >= 2 && value === 3) { zeros = 0; continue; }
    rbsp.push(value);
    zeros = value === 0 ? zeros + 1 : 0;
  }
  let bitOffset = 0;
  const readBits = count => {
    if (bitOffset + count > rbsp.length * 8) throw new Error('Truncated HEVC SPS');
    let value = 0n;
    for (let i = 0; i < count; i += 1) {
      const byte = rbsp[bitOffset >> 3];
      const bit = (byte >> (7 - (bitOffset & 7))) & 1;
      value = (value << 1n) | BigInt(bit);
      bitOffset += 1;
    }
    return value;
  };
  const skipBits = count => { readBits(count); };

  skipBits(4); // sps_video_parameter_set_id
  const maxSubLayersMinus1 = Number(readBits(3));
  skipBits(1); // sps_temporal_id_nesting_flag
  const profileSpace = Number(readBits(2));
  const tierFlag = Number(readBits(1));
  const profileIdc = Number(readBits(5));
  const compatibilityBits = readBits(32);
  const constraintBits = readBits(48);
  const levelIdc = Number(readBits(8));
  const subLayerProfilePresent = [];
  const subLayerLevelPresent = [];
  for (let i = 0; i < maxSubLayersMinus1; i += 1) {
    subLayerProfilePresent.push(Number(readBits(1)) === 1);
    subLayerLevelPresent.push(Number(readBits(1)) === 1);
  }
  if (maxSubLayersMinus1 > 0) skipBits((8 - maxSubLayersMinus1) * 2);
  for (let i = 0; i < maxSubLayersMinus1; i += 1) {
    if (subLayerProfilePresent[i]) skipBits(2 + 1 + 5 + 32 + 48);
    if (subLayerLevelPresent[i]) skipBits(8);
  }

  const compatibility = compatibilityBits.toString(2).padStart(32, '0').split('').reverse().join('');
  const compatibilityHex = BigInt(`0b${compatibility}`).toString(16);
  const constraints = constraintBits.toString(16).padStart(12, '0').toUpperCase().replace(/(?:00)+$/, '');
  const spacePrefix = profileSpace === 0 ? '' : String.fromCharCode(64 + profileSpace);
  return `hev1.${spacePrefix}${profileIdc}.${compatibilityHex}.${tierFlag ? 'H' : 'L'}${levelIdc}${constraints ? `.${constraints}` : ''}`;
}

function prependMissingHevcParameterSets(bytes, nals, parameterSets) {
  const included = new Set(nals.map(nal => (nal[0] >> 1) & 0x3f));
  const missing = [32, 33, 34].filter(type => !included.has(type)).map(type => parameterSets.get(type)).filter(Boolean);
  if (!missing.length) return bytes;
  const prefixLength = missing.reduce((total, nal) => total + nal.length + 4, 0);
  const result = new Uint8Array(prefixLength + bytes.length);
  let offset = 0;
  for (const nal of missing) {
    result.set([0, 0, 0, 1], offset);
    offset += 4;
    result.set(nal, offset);
    offset += nal.length;
  }
  result.set(bytes, offset);
  return result;
}

function parseAdts(data) {
  if (data.length < 7 || data[0] !== 0xff || (data[1] & 0xf6) !== 0xf0) return null;
  const profile = (data[2] >> 6) & 3;
  const frequencyIndex = (data[2] >> 2) & 15;
  const frequencies = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const sampleRate = frequencies[frequencyIndex];
  const channels = ((data[2] & 1) << 2) | ((data[3] >> 6) & 3);
  const headerLength = (data[1] & 1) ? 7 : 9;
  if (!sampleRate || !channels || data.length <= headerLength) return null;
  const asc = ((profile + 1) << 11) | (frequencyIndex << 7) | (channels << 3);
  return { sampleRate, channels, description: new Uint8Array([asc >> 8, asc & 255]), payload: data.subarray(headerLength) };
}

async function consumeMultipart(response, onPart) {
  const contentType = response.headers.get('content-type') || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const name = (match?.[1] || match?.[2] || '--DigifortBoundary').replace(/^--/, '');
  const boundaries = [`--${name}`, `----${name}`].map(value => new TextEncoder().encode(value));
  const reader = response.body.getReader();
  let buffer = new Uint8Array(0);
  let done = false;
  const concat = (left, right) => { const out = new Uint8Array(left.length + right.length); out.set(left); out.set(right, left.length); return out; };
  const indexOf = (haystack, needle, from = 0) => {
    outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
      for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  };
  const findBoundary = (from = 0) => {
    const found = boundaries.map(bytes => ({ index: indexOf(buffer, bytes, from), bytes })).filter(x => x.index >= 0).sort((a, b) => a.index - b.index);
    return found[0] || null;
  };
  const readMore = async () => {
    const result = await reader.read();
    if (result.done) { done = true; return; }
    buffer = concat(buffer, result.value);
  };
  const readUntil = async needle => {
    let index;
    while ((index = indexOf(buffer, needle)) < 0 && !done) await readMore();
    return index;
  };
  while (!done || buffer.length) {
    let boundary = findBoundary();
    while (!boundary && !done) { await readMore(); boundary = findBoundary(); }
    if (!boundary) break;
    buffer = buffer.subarray(boundary.index + boundary.bytes.length);
    while (buffer.length < 2 && !done) await readMore();
    if (buffer[0] === 45 && buffer[1] === 45) break;
    if (buffer[0] === 13 && buffer[1] === 10) buffer = buffer.subarray(2);
    const separator = new Uint8Array([13, 10, 13, 10]);
    const headerEnd = await readUntil(separator);
    if (headerEnd < 0) break;
    const rawHeaders = new TextDecoder().decode(buffer.subarray(0, headerEnd));
    buffer = buffer.subarray(headerEnd + separator.length);
    const headers = {};
    for (const line of rawHeaders.split(/\r?\n/)) {
      const split = line.indexOf(':');
      if (split > 0) headers[line.slice(0, split).trim().toLowerCase()] = line.slice(split + 1).trim();
    }
    const length = Number(headers['content-length']);
    if (!Number.isFinite(length) || length < 0 || length > 25_000_000) throw new Error('Frame multipart com tamanho inválido.');
    while (buffer.length < length && !done) await readMore();
    if (buffer.length < length) break;
    const data = buffer.slice(0, length);
    buffer = buffer.subarray(length);
    if (buffer[0] === 13 && buffer[1] === 10) buffer = buffer.subarray(2);
    onPart({ headers, data });
  }
}


export { consumeMultipart };
