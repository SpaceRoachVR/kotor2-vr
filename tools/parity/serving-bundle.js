const crypto = require('crypto');

function isRuntimeUrl(value) {
  try { return /\/KotOR\.js$/i.test(new URL(value).pathname); } catch { return false; }
}

/** CDP runs outside the page realm: engine code cannot forge these observations. */
class ServingBundleObserver {
  constructor(cdp) {
    this.cdp = cdp;
    this.responses = [];
    this.completedRequests = new Set();
    this.scripts = [];
    this.contexts = new Map();
  }

  async hashObservedSource(method, params) {
    try {
      const result = await this.cdp.send(method, params);
      let bytes;
      if (method === 'Network.getResponseBody') {
        if (!result || typeof result.body !== 'string' || !result.body.length || typeof result.base64Encoded !== 'boolean') return null;
        bytes = Buffer.from(result.body, result.base64Encoded ? 'base64' : 'utf8');
      } else {
        if (!result || typeof result.scriptSource !== 'string' || !result.scriptSource.length) return null;
        bytes = Buffer.from(result.scriptSource, 'utf8');
      }
      return crypto.createHash('sha256').update(bytes).digest('hex');
    } catch {
      // Browser buffer eviction, navigation, and protocol failures all deny
      // provenance. Never surface protocol payloads that could include URLs.
      return null;
    }
  }

  async start() {
    this.cdp.on('Network.responseReceived', (event) => {
      if (event.type !== 'Script' || !event.response || !isRuntimeUrl(event.response.url)) return;
      // Do not retain headers, cookies, authorization, or unrelated requests.
      this.responses.push({ requestId: event.requestId, frameId: event.frameId,
        url: event.response.url, status: event.response.status });
    });
    this.cdp.on('Network.loadingFinished', (event) => {
      const response = this.responses.find((entry) => entry.requestId === event.requestId);
      if (!response) return;
      this.completedRequests.add(event.requestId);
      // Retain the digest immediately: module asset traffic may evict this
      // response from Chrome's body cache long before a snapshot completes.
      response.sha256 = this.hashObservedSource('Network.getResponseBody', { requestId: event.requestId });
    });
    this.cdp.on('Network.loadingFailed', (event) => this.completedRequests.delete(event.requestId));
    this.cdp.on('Debugger.scriptParsed', (event) => {
      if (isRuntimeUrl(event.url)) this.scripts.push({ scriptId: event.scriptId,
        url: event.url, contextId: event.executionContextId,
        sha256: this.hashObservedSource('Debugger.getScriptSource', { scriptId: event.scriptId }) });
    });
    this.cdp.on('Runtime.executionContextCreated', ({ context }) => {
      if (context && context.auxData) this.contexts.set(context.id, context.auxData);
    });
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Network.enable', {
      maxTotalBufferSize: 256 * 1024 * 1024, maxResourceBufferSize: 128 * 1024 * 1024,
    });
    await this.cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await this.cdp.send('Network.setBypassServiceWorker', { bypass: true });
    await this.cdp.send('Debugger.enable', { maxScriptsCacheSize: 128 * 1024 * 1024 });
  }

  async identify(mainFrameId) {
    if (this.responses.length !== 1) throw new Error('Trusted CDP observation requires exactly one KotOR.js script response');
    const response = this.responses[0];
    const url = new URL(response.url);
    const address = /^\/bundles\/([a-f0-9]{64})\/KotOR\.js$/.exec(url.pathname);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !address) {
      throw new Error('Trusted CDP observation requires a credential-free content-addressed runtime URL');
    }
    if (!mainFrameId || response.frameId !== mainFrameId) throw new Error('Runtime response did not belong to the main frame');
    if (response.status !== 200 || !this.completedRequests.has(response.requestId)) throw new Error('Runtime response was not successfully completed');
    const scripts = this.scripts.filter((script) => {
      const context = this.contexts.get(script.contextId);
      return script.url === response.url && context && context.isDefault === true && context.frameId === mainFrameId;
    });
    if (scripts.length !== 1) throw new Error('Runtime response requires exactly one matching parsed script in the main frame');
    const sha256 = await response.sha256;
    if (!sha256) {
      throw new Error('Trusted CDP observation did not retain the runtime response body');
    }
    if (sha256 !== address[1]) throw new Error('Runtime response bytes do not match their content address');
    if (await scripts[0].sha256 !== sha256) {
      throw new Error('Runtime response bytes do not match the parsed script source');
    }
    return Object.freeze({ url: url.toString(), sha256 });
  }
}

module.exports = { ServingBundleObserver };
