/**
 * Minimal Chrome DevTools Protocol client.
 *
 * `ws` is already present in the tree (webpack-dev-server depends on it), so
 * this avoids adding puppeteer for what is a few dozen lines of request/reply
 * plumbing. One socket per target; `send` resolves with the CDP result or
 * rejects with the CDP error.
 */
const http = require('http');
const WebSocket = require('ws');

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Non-JSON response from ${url}: ${body.slice(0, 200)}`));
          }
        });
      })
      .on('error', reject);
  });
}

async function waitForEndpoint(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await httpGetJson(`http://127.0.0.1:${port}/json/version`);
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`CDP endpoint on ${port} never came up: ${lastError && lastError.message}`);
}

async function findPageTarget(port, urlPredicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await httpGetJson(`http://127.0.0.1:${port}/json/list`);
    const match = targets.find((t) => t.type === 'page' && urlPredicate(t.url));
    if (match && match.webSocketDebuggerUrl) return match;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No matching page target appeared on port ${port}`);
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
        return;
      }
      if (message.method) {
        const handlers = this.listeners.get(message.method) || [];
        for (const handler of handlers) handler(message.params);
      }
    });
  }

  static async connect(webSocketDebuggerUrl) {
    const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return new CdpSession(ws);
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Evaluate an expression in the page and return its value by value.
   * Rejects on a thrown exception rather than resolving with the error object,
   * so a failed step stops the scenario instead of silently continuing.
   */
  async evaluate(expression, { awaitPromise = true, timeoutMs = 60000 } = {}) {
    const result = await Promise.race([
      this.send('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true,
        userGesture: true,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`evaluate timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    if (result.exceptionDetails) {
      const desc =
        (result.exceptionDetails.exception && result.exceptionDetails.exception.description) ||
        result.exceptionDetails.text;
      throw new Error(`Page exception: ${desc}`);
    }
    return result.result.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

module.exports = { CdpSession, waitForEndpoint, findPageTarget, httpGetJson };
