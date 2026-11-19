const DIGIFORT_REQUEST_HEADERS = Object.freeze({
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Accept-Encoding': 'gzip, deflate'
});

async function fetchDigifort(config, url, options = {}, operation = 'upstream_request', fetchImpl = fetch, report = message => process.stderr.write(message)) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers({ ...DIGIFORT_REQUEST_HEADERS, 'User-Agent': config.userAgent });
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  try {
    const response = await fetchImpl(url, { ...options, headers });
    return response;
  } catch (error) {
    const causeCode = error?.cause?.code;
    const safeCode = typeof causeCode === 'string' && /^[a-z0-9_]+$/i.test(causeCode)
      ? causeCode
      : error?.name === 'TimeoutError' ? 'TIMEOUT' : 'FETCH_ERROR';
    report(`[api:transport-error] ${method} ${operation} ${safeCode}\n`);
    throw new Error(`Falha de transporte na etapa ${operation} (${safeCode}).`);
  }
}


export function createHttpAdapter({ fetchImpl = fetch, report = message => process.stderr.write(message) } = {}) {
  return { request: (config, url, options = {}, operation = 'upstream_request') => fetchDigifort(config, url, options, operation, fetchImpl, report) };
}
