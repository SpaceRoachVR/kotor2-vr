import { createHash } from 'crypto';
import { describe, expect, test } from '@jest/globals';

const { ServingBundleObserver } = require('../../tools/parity/serving-bundle');

function fixture(body = 'globalThis.KotOR = {};') {
  const sha256 = createHash('sha256').update(body).digest('hex');
  const url = `http://127.0.0.1:9447/bundles/${sha256}/KotOR.js`;
  const listeners = new Map<string, (event: any) => void>();
  const commands: string[] = [];
  const replies: Record<string, unknown> = {
    'Network.getResponseBody': { body: Buffer.from(body).toString('base64'), base64Encoded: true },
    'Debugger.getScriptSource': { scriptSource: body },
  };
  const observer = new ServingBundleObserver({
    on: (name: string, listener: (event: any) => void) => listeners.set(name, listener),
    send: async (name: string) => { commands.push(name); return replies[name] || {}; },
    evaluate: async () => { throw new Error('Page-owned evaluation must never establish provenance'); },
  });
  const emit = (name: string, event: unknown) => listeners.get(name)?.(event);
  const record = () => {
    emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'document-1' } });
    emit('Runtime.executionContextCreated', { context: { id: 1, uniqueId: 'context-1', auxData: { frameId: 'main', isDefault: true } } });
    emit('Network.responseReceived', { requestId: 'request', loaderId: 'document-1', frameId: 'main', type: 'Script', response: { url, status: 200 } });
    emit('Network.loadingFinished', { requestId: 'request' });
    emit('Debugger.scriptParsed', { scriptId: 'script', url, executionContextId: 1 });
  };
  return { observer, emit, record, replies, commands, sha256, url };
}

describe('trusted parity serving provenance', () => {
  test('hashes external response bytes and parsed source despite monkeypatched page APIs', async () => {
    const body = `document.querySelectorAll = () => [{ src: 'forged', integrity: 'forged' }];
      performance.getEntriesByType = () => [{ name: 'forged', initiatorType: 'script' }];
      globalThis.KotOR = {};`;
    const f = fixture(body);
    await f.observer.start();
    f.record();
    await expect(f.observer.identify('main')).resolves.toEqual({ url: f.url, sha256: f.sha256 });
    expect(f.commands).toContain('Network.getResponseBody');
    expect(f.commands).toContain('Debugger.getScriptSource');
  });

  test('rejects duplicate, foreign-frame, and mismatched script bytes', async () => {
    const f = fixture();
    await f.observer.start();
    await expect(f.observer.identify('main')).rejects.toThrow(/exactly one/i);
    f.replies['Debugger.getScriptSource'] = { scriptSource: 'different executed bytes' };
    f.record();
    await expect(f.observer.identify('other-frame')).rejects.toThrow(/main frame/i);
    await expect(f.observer.identify('main')).rejects.toThrow(/parsed script/i);
    f.emit('Network.responseReceived', { requestId: 'duplicate', loaderId: 'document-1', frameId: 'main', type: 'Script', response: { url: f.url, status: 200 } });
    await expect(f.observer.identify('main')).rejects.toThrow(/exactly one/i);
  });

  test('a downloaded decoy that Chrome never parsed cannot establish executed provenance', async () => {
    const f = fixture();
    await f.observer.start();
    f.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'document-1' } });
    f.emit('Runtime.executionContextCreated', { context: { id: 1, uniqueId: 'context-1', auxData: { frameId: 'main', isDefault: true } } });
    f.emit('Network.responseReceived', { requestId: 'request', loaderId: 'document-1', frameId: 'main', type: 'Script', response: { url: f.url, status: 200 } });
    f.emit('Network.loadingFinished', { requestId: 'request' });
    await expect(f.observer.identify('main')).rejects.toThrow(/parsed script/i);
  });

  test('rejects failed loads and mismatched content addresses', async () => {
    const f = fixture();
    await f.observer.start();
    f.record();
    f.emit('Network.loadingFailed', { requestId: 'request' });
    await expect(f.observer.identify('main')).rejects.toThrow(/completed/i);
    const altered = fixture();
    await altered.observer.start();
    altered.replies['Network.getResponseBody'] = { body: 'changed', base64Encoded: false };
    altered.record();
    await expect(altered.observer.identify('main')).rejects.toThrow(/content address/i);
  });

  test('retains the observed hash before module traffic can evict the response body', async () => {
    const f = fixture();
    await f.observer.start();
    f.record();
    await Promise.resolve();
    f.replies['Network.getResponseBody'] = {};
    f.replies['Debugger.getScriptSource'] = {};
    await expect(f.observer.identify('main')).resolves.toEqual({ url: f.url, sha256: f.sha256 });
  });

  test.each(['Runtime.executionContextDestroyed', 'Runtime.executionContextsCleared', 'Page.frameNavigated'])(
    'invalidates previously identified provenance on %s', async (eventName) => {
      const f = fixture();
      await f.observer.start();
      f.record();
      await expect(f.observer.identify('main')).resolves.toEqual({ url: f.url, sha256: f.sha256 });
      f.emit(eventName, eventName === 'Page.frameNavigated'
        ? { frame: { id: 'main', loaderId: 'document-2' } } : { executionContextId: 1 });
      f.emit('Runtime.executionContextCreated', { context: { id: 1, uniqueId: 'context-2', auxData: { frameId: 'main', isDefault: true } } });
      await expect(f.observer.identify('main')).rejects.toThrow();
    },
  );

  test('binds capture evaluations to a live unique context and rejects navigation during collection', async () => {
    const f = fixture();
    await f.observer.start();
    f.record();
    const binding = f.observer.bindContext('main');
    f.observer.cdp.evaluate = async (_expression: string, options: { uniqueContextId: string }) => {
      expect(options.uniqueContextId).toBe('context-1');
      f.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'document-2' } });
      return { fromOldDocument: true };
    };
    await expect(f.observer.evaluate(binding, 'snapshot()')).rejects.toThrow(/active document|live context/i);
    await expect(f.observer.identify('main', binding)).rejects.toThrow();
  });

  test('does not correlate a previous loader response with the new document context', async () => {
    const f = fixture();
    await f.observer.start();
    f.record();
    const oldBinding = f.observer.bindContext('main');
    f.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'document-2' } });
    f.emit('Runtime.executionContextCreated', { context: { id: 1, uniqueId: 'context-2', auxData: { frameId: 'main', isDefault: true } } });
    f.emit('Network.responseReceived', { requestId: 'old-loader', loaderId: 'document-1', frameId: 'main', type: 'Script', response: { url: f.url, status: 200 } });
    f.emit('Network.loadingFinished', { requestId: 'old-loader' });
    f.emit('Debugger.scriptParsed', { scriptId: 'new-script', url: f.url, executionContextId: 1 });
    await expect(f.observer.identify('main')).rejects.toThrow(/exactly one/i);
    f.emit('Network.responseReceived', { requestId: 'new-loader', loaderId: 'document-2', frameId: 'main', type: 'Script', response: { url: f.url, status: 200 } });
    f.emit('Network.loadingFinished', { requestId: 'new-loader' });
    await expect(f.observer.identify('main')).resolves.toEqual({ url: f.url, sha256: f.sha256 });
    await expect(f.observer.identify('main', oldBinding)).rejects.toThrow(/active document|live context/i);
  });

  test('rechecks document identity after asynchronous response hashing', async () => {
    const f = fixture();
    let completeBody!: (value: unknown) => void;
    f.replies['Network.getResponseBody'] = new Promise((resolve) => { completeBody = resolve; });
    await f.observer.start();
    f.record();
    const result = f.observer.identify('main');
    f.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'document-2' } });
    completeBody({ body: 'globalThis.KotOR = {};', base64Encoded: false });
    await expect(result).rejects.toThrow(/active document|live context/i);
  });

  test('sends the unique execution context selector through the CDP evaluation adapter', async () => {
    const { CdpSession } = require('../../tools/vr-emulator/cdp');
    const session = Object.create(CdpSession.prototype);
    session.send = async (method: string, params: Record<string, unknown>) => {
      expect(method).toBe('Runtime.evaluate');
      expect(params.uniqueContextId).toBe('context-1');
      return { result: { value: 'captured' } };
    };
    await expect(session.evaluate('snapshot()', { uniqueContextId: 'context-1' })).resolves.toBe('captured');
    await expect(session.evaluate('snapshot()', { uniqueContextId: '' })).rejects.toThrow(/context/i);
  });
});
