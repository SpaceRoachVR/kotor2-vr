/**
 * Streaming reader for a V8 `.heapsnapshot`.
 *
 * A snapshot of this page is 2.3 GB, which is past both `JSON.parse` and Node's
 * maximum string length, so it cannot be read the obvious way. The format is
 * predictable enough to scan instead: one top-level object whose big members are
 * flat arrays - `nodes` and `edges` are arrays of integers, `strings` an array of
 * strings - emitted in a fixed order.
 *
 * Each function here opens its own read stream and walks to the member it wants,
 * so a caller pays one pass per member it needs and never holds the file.
 */
const fs = require('fs');

/** The small `snapshot` member at the head of the file, parsed normally. */
function readHeader(file, bytes = 256 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buf, 0, bytes, 0);
    const head = buf.slice(0, read).toString('utf8');
    const at = head.indexOf('"snapshot"');
    if (at === -1) throw new Error('no snapshot member in the first chunk');
    const open = head.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < head.length; i++) {
      if (head[i] === '{') depth++;
      else if (head[i] === '}') {
        depth--;
        if (depth === 0) return JSON.parse(head.slice(open, i + 1));
      }
    }
    throw new Error('snapshot member did not close within the first chunk');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Walk `"<key>":[ ... ]` calling `onValue` for each integer.
 *
 * Values are non-negative integers separated by commas, so this accumulates
 * digits and flushes on any separator. Nothing else in the section can be
 * mistaken for one.
 */
function scanIntArray(file, key, onValue) {
  return new Promise((resolve, reject) => {
    const needle = `"${key}":[`;
    let pending = '';
    let started = false;
    let done = false;
    let value = 0;
    let inValue = false;
    let count = 0;

    const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 16 * 1024 * 1024 });
    stream.on('data', (chunk) => {
      if (done) return;
      let text = chunk;
      if (!started) {
        // The needle can straddle a chunk boundary, so keep a tail of the
        // previous chunk long enough to contain it.
        pending += text;
        const at = pending.indexOf(needle);
        if (at === -1) {
          pending = pending.slice(-needle.length);
          return;
        }
        started = true;
        text = pending.slice(at + needle.length);
        pending = '';
      }
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c >= 48 && c <= 57) {
          value = value * 10 + (c - 48);
          inValue = true;
        } else if (c === 93) { // ]
          if (inValue) { onValue(value, count++); value = 0; inValue = false; }
          done = true;
          stream.destroy();
          return;
        } else {
          if (inValue) { onValue(value, count++); value = 0; inValue = false; }
        }
      }
    });
    stream.on('close', () => resolve(count));
    stream.on('end', () => resolve(count));
    stream.on('error', reject);
  });
}

/** Walk `"<key>":[ ... ]` calling `onValue` for each string, in order. */
function scanStringArray(file, key, onValue) {
  return new Promise((resolve, reject) => {
    const needle = `"${key}":[`;
    let pending = '';
    let started = false;
    let done = false;
    let inString = false;
    let escaped = false;
    let token = '';
    let count = 0;

    const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 16 * 1024 * 1024 });
    stream.on('data', (chunk) => {
      if (done) return;
      let text = chunk;
      if (!started) {
        pending += text;
        const at = pending.indexOf(needle);
        if (at === -1) {
          pending = pending.slice(-needle.length);
          return;
        }
        started = true;
        text = pending.slice(at + needle.length);
        pending = '';
      }
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
          if (escaped) { token += ch; escaped = false; continue; }
          if (ch === '\\') { token += ch; escaped = true; continue; }
          if (ch === '"') {
            inString = false;
            let decoded;
            try { decoded = JSON.parse('"' + token + '"'); } catch (e) { decoded = token; }
            onValue(decoded, count++);
            token = '';
            continue;
          }
          token += ch;
          continue;
        }
        if (ch === '"') { inString = true; token = ''; continue; }
        if (ch === ']') { done = true; stream.destroy(); return; }
      }
    });
    stream.on('close', () => resolve(count));
    stream.on('end', () => resolve(count));
    stream.on('error', reject);
  });
}

module.exports = { readHeader, scanIntArray, scanStringArray };
