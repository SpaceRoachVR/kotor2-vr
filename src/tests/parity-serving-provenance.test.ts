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
  const emit = (name: string, event: unknown) => listeners.get(name)!(event);
  const record = () => {
    emit('Runtime.executionContextCreated', { context: { id: 1, auxData: { frameId: 'main', isDefault: true } } });
    emit('Network.responseReceived', { requestId: 'request', frameId: 'main', type: 'Script', response: { url, status: 200 } });
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
    f.emit('Network.responseReceived', { requestId: 'duplicate', frameId: 'main', type: 'Script', response: { url: f.url, status: 200 } });
    await expect(f.observer.identify('main')).rejects.toThrow(/exactly one/i);
  });

  test('a downloaded decoy that Chrome never parsed cannot establish executed provenance', async () => {
    const f = fixture();
    await f.observer.start();
    f.emit('Network.responseReceived', { requestId: 'request', frameId: 'main', type: 'Script', response: { url: f.url, status: 200 } });
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
});
