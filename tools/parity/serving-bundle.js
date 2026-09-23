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
    this.document = null;
    this.generation = 0;
  }

  invalidate() {
    this.generation++;
    this.responses = [];
    this.completedRequests.clear();
    this.scripts = [];
    this.contexts.clear();
  }

  bindContext(mainFrameId) {
    if (!this.document || this.document.frameId !== mainFrameId || !this.document.loaderId) {
      throw new Error('Canonical capture requires an active document in the main frame');
    }
    const contexts = [...this.contexts.values()].filter((context) => context.frameId === mainFrameId && context.isDefault === true);
    if (contexts.length !== 1 || !contexts[0].uniqueId) throw new Error('Canonical capture requires exactly one live context in the main frame');
    return Object.freeze({ ...this.document, generation: this.generation,
      contextId: contexts[0].id, uniqueContextId: contexts[0].uniqueId });
  }

  assertActive(binding) {
    const context = binding && this.contexts.get(binding.contextId);
    if (!binding || !this.document || binding.generation !== this.generation
        || binding.frameId !== this.document.frameId || binding.loaderId !== this.document.loaderId
        || !context || context.uniqueId !== binding.uniqueContextId || context.isDefault !== true) {
      throw new Error('Canonical capture lost its active document or live context');
    }
  }

  async evaluate(binding, expression, options = {}) {
    this.assertActive(binding);
    const result = await this.cdp.evaluate(expression, { ...options, uniqueContextId: binding.uniqueContextId });
    this.assertActive(binding);
    return result;
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
    this.cdp.on('Page.frameNavigated', ({ frame }) => {
      if (!frame || frame.parentId) return;
      this.invalidate();
      this.document = { frameId: frame.id, loaderId: frame.loaderId };
    });
    this.cdp.on('Runtime.executionContextsCleared', () => this.invalidate());
    this.cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => {
      const context = this.contexts.get(executionContextId);
      if (context && this.document && context.frameId === this.document.frameId && context.isDefault === true) {
        this.invalidate();
      } else {
        this.contexts.delete(executionContextId);
        this.scripts = this.scripts.filter((script) => script.contextId !== executionContextId);
      }
    });
    this.cdp.on('Network.responseReceived', (event) => {
      if (event.type !== 'Script' || !event.response || !isRuntimeUrl(event.response.url)) return;
      if (!this.document || event.frameId !== this.document.frameId || event.loaderId !== this.document.loaderId) return;
      // Do not retain headers, cookies, authorization, or unrelated requests.
      this.responses.push({ requestId: event.requestId, frameId: event.frameId, loaderId: event.loaderId,
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
      const context = this.contexts.get(event.executionContextId);
      if (!context || !this.document || context.frameId !== this.document.frameId || context.isDefault !== true) return;
      if (isRuntimeUrl(event.url)) this.scripts.push({ scriptId: event.scriptId,
        url: event.url, contextId: event.executionContextId, uniqueContextId: context.uniqueId,
        sha256: this.hashObservedSource('Debugger.getScriptSource', { scriptId: event.scriptId }) });
    });
    this.cdp.on('Runtime.executionContextCreated', ({ context }) => {
      if (context && context.auxData) this.contexts.set(context.id, { ...context.auxData, id: context.id, uniqueId: context.uniqueId });
    });
    await this.cdp.send('Page.enable');
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Network.enable', {
      maxTotalBufferSize: 256 * 1024 * 1024, maxResourceBufferSize: 128 * 1024 * 1024,
    });
    await this.cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await this.cdp.send('Network.setBypassServiceWorker', { bypass: true });
    await this.cdp.send('Debugger.enable', { maxScriptsCacheSize: 128 * 1024 * 1024 });
  }

  async identify(mainFrameId, binding) {
    if (this.responses.length !== 1) throw new Error('Trusted CDP observation requires exactly one KotOR.js script response');
    const activeBinding = binding || this.bindContext(mainFrameId);
    this.assertActive(activeBinding);
    const response = this.responses[0];
    const url = new URL(response.url);
    const address = /^\/bundles\/([a-f0-9]{64})\/KotOR\.js$/.exec(url.pathname);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !address) {
      throw new Error('Trusted CDP observation requires a credential-free content-addressed runtime URL');
    }
    if (!mainFrameId || response.frameId !== mainFrameId || response.loaderId !== activeBinding.loaderId) throw new Error('Runtime response did not belong to the main frame active document');
    if (response.status !== 200 || !this.completedRequests.has(response.requestId)) throw new Error('Runtime response was not successfully completed');
    const scripts = this.scripts.filter((script) => {
      const context = this.contexts.get(script.contextId);
      return script.url === response.url && context && context.id === activeBinding.contextId
        && script.uniqueContextId === activeBinding.uniqueContextId
        && context.uniqueId === activeBinding.uniqueContextId && context.isDefault === true && context.frameId === mainFrameId;
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
    this.assertActive(activeBinding);
    return Object.freeze({ url: url.toString(), sha256 });
  }
}

module.exports = { ServingBundleObserver };
