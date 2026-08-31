const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const SESSION_COOKIE_NAME = 'kotor2vr_session';
const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

function createAssetService(options) {
  return new AssetService(options);
}

class AssetService {
  constructor(options) {
    if (!options || typeof options !== 'object') {
      throw new TypeError('Asset service options are required');
    }

    this.assetRoot = validateDirectoryRoot(options.assetRoot, 'assetRoot');
    this.userRoot = validateDirectoryRoot(options.userRoot, 'userRoot');
    this.distRoot = validateDirectoryRoot(options.distRoot, 'distRoot');
    validateDistinctRoots(this.assetRoot, this.userRoot, this.distRoot);
    this.modRoots = validateModRoots(options.modRoots, this.assetRoot, this.userRoot, this.distRoot);
    this.token = validateToken(options.token);
    this.host = validateLoopbackHost(options.host || '127.0.0.1');
    this.port = validatePort(options.port === undefined ? 0 : options.port);
    this.version = typeof options.version === 'string' ? options.version : 'unknown';
    this.maxBodyBytes = validateMaxBodyBytes(
      options.maxBodyBytes === undefined ? DEFAULT_MAX_BODY_BYTES : options.maxBodyBytes
    );
    this.onBeforeFileOpen = options.onBeforeFileOpen === undefined
      ? undefined
      : validateBeforeFileOpen(options.onBeforeFileOpen);
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        this.handleUnexpectedError(response, error);
      });
    });
    this.baseUrl = undefined;
    this.started = false;
  }

  async start() {
    if (this.started) return this;

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off('error', onError);
        resolve();
      };

      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(this.port, this.host);
    });

    const address = this.server.address();
    if (!address || typeof address === 'string') {
      await this.close();
      throw new Error('Asset service did not provide a network address');
    }

    const hostForUrl = this.host.includes(':') ? `[${this.host}]` : this.host;
    this.baseUrl = normalizeHttpOrigin(`http://${hostForUrl}:${address.port}`);
    this.started = true;
    return this;
  }

  async close() {
    if (!this.started) return;

    await new Promise((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
    this.started = false;
    this.baseUrl = undefined;
  }

  async handleRequest(request, response) {
    const requestUrl = new URL(request.url || '/', 'http://loopback.invalid');

    if (requestUrl.pathname === '/launch') {
      return this.handleLaunch(request, response, requestUrl);
    }

    if (!this.isRequestOriginAllowed(request)) {
      return sendError(response, 403, 'origin is not allowed');
    }

    if (!this.isAuthenticated(request)) {
      return sendError(response, 401, 'unauthorized');
    }

    if (requestUrl.pathname === '/health') {
      if (request.method !== 'GET') return sendMethodNotAllowed(response, ['GET']);
      return sendJson(response, 200, {
        version: this.version,
        gameDetected: this.isGameDetected(),
        userDataWritable: isDirectoryWritable(this.userRoot),
      });
    }

    if (requestUrl.pathname === '/directories') {
      if (request.method !== 'GET') return sendMethodNotAllowed(response, ['GET']);
      return this.handleDirectoryListing(response, requestUrl);
    }

    if (requestUrl.pathname.startsWith('/assets/')) {
      return this.handleAssetFile(request, response, requestUrl.pathname.slice('/assets/'.length));
    }

    if (requestUrl.pathname.startsWith('/user/')) {
      return this.handleUserFile(request, response, requestUrl.pathname.slice('/user/'.length));
    }

    if (requestUrl.pathname.startsWith('/game/')) {
      return this.handleReadOnlyFile(request, response, requestUrl.pathname.slice(1), this.distRoot, 'no-store');
    }

    // Webpack emits shared runtime bundles (for example KotOR.js and
    // three.min.js) at the dist root while the game HTML lives under /game.
    // Keep the fallback authenticated and read-only, and apply the same
    // containment checks as every other static file route.
    return this.handleReadOnlyFile(request, response, requestUrl.pathname.slice(1), this.distRoot, 'no-store');
  }

  handleLaunch(request, response, requestUrl) {
    if (request.method !== 'GET') return sendMethodNotAllowed(response, ['GET']);
    const launchToken = requestUrl.searchParams.get('token');
    if (!launchToken || !tokensMatch(launchToken, this.token)) {
      return sendError(response, 401, 'unauthorized');
    }

    const encodedToken = encodeURIComponent(this.token);
    response.statusCode = 302;
    response.setHeader('Location', '/game/index.html?key=tsl&assets=/assets');
    response.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${encodedToken}; HttpOnly; SameSite=Strict; Path=/`
    );
    response.end();
  }

  handleDirectoryListing(response, requestUrl) {
    const rootName = requestUrl.searchParams.get('root');
    const root = rootName === 'assets' ? this.assetRoot : rootName === 'user' ? this.userRoot : undefined;
    if (!root) return sendError(response, 400, 'invalid directory root');

    const relative = parseRelativePath(requestUrl.searchParams.get('path') || '');
    if (rootName === 'user' && this.isProtectedUserPath(relative)) {
      return sendError(response, 404, 'not found');
    }
    if (rootName === 'assets' && this.isOverridePath(relative)) {
      return this.handleOverlayDirectoryListing(response, relative);
    }
    const resolved = resolveExistingPath(root, relative);
    if (!resolved) return sendError(response, 404, 'not found');
    if (!resolved.stats.isDirectory()) {
      return sendJson(response, 200, { isDirectory: false, entries: [] });
    }

    const entries = [];
    for (const entry of fs.readdirSync(resolved.path, { withFileTypes: true })) {
      if (rootName === 'user' && entry.name.toLocaleLowerCase() === 'mods') continue;
      const entryPath = path.join(resolved.path, entry.name);
      try {
        const realEntryPath = fs.realpathSync(entryPath);
        if (!isInsideRoot(root, realEntryPath)) continue;
        entries.push({ name: entry.name, directory: fs.statSync(entryPath).isDirectory() });
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    return sendJson(response, 200, { isDirectory: true, entries });
  }

  handleAssetFile(request, response, rawRelativePath) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return sendMethodNotAllowed(response, ['GET', 'HEAD']);
    }
    const relative = parseRelativePath(rawRelativePath);
    if (relative.length === 0) return sendError(response, 404, 'not found');
    const resolved = this.resolveAssetPath(relative);
    if (!resolved || resolved.stats.isDirectory()) return sendError(response, 404, 'not found');
    if (resolved.layerId) response.setHeader('X-Kotor2VR-Asset-Layer', resolved.layerId);
    return sendFile(request, response, resolved.path, resolved.stats, this.onBeforeFileOpen);
  }

  isOverridePath(relative) {
    return relative.length > 0 && relative[0].toLocaleLowerCase() === 'override';
  }

  resolveAssetPath(relative) {
    if (!this.isOverridePath(relative)) {
      return resolveExistingPath(this.assetRoot, relative);
    }
    for (let index = this.modRoots.length - 1; index >= 0; index -= 1) {
      const resolved = resolveExistingPath(this.modRoots[index], relative);
      if (resolved) return { ...resolved, layerId: `mod-${index + 1}` };
    }
    const retail = resolveExistingPath(this.assetRoot, relative);
    return retail ? { ...retail, layerId: 'retail' } : undefined;
  }

  handleOverlayDirectoryListing(response, relative) {
    const layers = [this.assetRoot, ...this.modRoots];
    const merged = new Map();
    let foundDirectory = false;
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
      const layerRoot = layers[layerIndex];
      const resolved = resolveExistingPath(layerRoot, relative);
      if (!resolved) continue;
      if (!resolved.stats.isDirectory()) {
        return sendJson(response, 200, { isDirectory: false, entries: [] });
      }
      foundDirectory = true;
      for (const entry of fs.readdirSync(resolved.path, { withFileTypes: true })) {
        const entryPath = path.join(resolved.path, entry.name);
        try {
          const realEntryPath = fs.realpathSync(entryPath);
          if (!isInsideRoot(layerRoot, realEntryPath)) continue;
          merged.set(entry.name.toLocaleLowerCase(), {
            name: entry.name,
            directory: fs.statSync(entryPath).isDirectory(),
            layer: layerIndex === 0 ? 'retail' : `mod-${layerIndex}`,
          });
        } catch (error) {
          if (!isMissingPathError(error)) throw error;
        }
      }
    }
    if (!foundDirectory) return sendError(response, 404, 'not found');
    const entries = [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
    return sendJson(response, 200, { isDirectory: true, entries });
  }

  handleReadOnlyFile(request, response, rawRelativePath, root, cacheControl = 'private, max-age=3600') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return sendMethodNotAllowed(response, ['GET', 'HEAD']);
    }

    const relative = parseRelativePath(rawRelativePath);
    if (relative.length === 0) return sendError(response, 404, 'not found');
    const resolved = resolveExistingPath(root, relative);
    if (!resolved) return sendError(response, 404, 'not found');
    if (resolved.stats.isDirectory()) return sendError(response, 404, 'not found');
    return sendFile(request, response, resolved.path, resolved.stats, this.onBeforeFileOpen, cacheControl);
  }

  async handleUserFile(request, response, rawRelativePath) {
    const relative = parseRelativePath(rawRelativePath);
    if (relative.length === 0) return sendError(response, 404, 'not found');
    if (this.isProtectedUserPath(relative)) return sendError(response, 404, 'not found');

    if (request.method === 'GET' || request.method === 'HEAD') {
      const resolved = resolveExistingPath(this.userRoot, relative);
      if (!resolved) return sendError(response, 404, 'not found');
      if (resolved.stats.isDirectory()) return sendError(response, 404, 'not found');
      return sendFile(request, response, resolved.path, resolved.stats, this.onBeforeFileOpen);
    }

    if (request.method === 'PUT') {
      if (!isDirectoryWritable(this.userRoot)) return sendError(response, 503, 'user data is not writable');
      const body = await readRequestBody(request, this.maxBodyBytes);
      const target = resolveUserWriteTarget(this.userRoot, relative);
      atomicWriteFile(target, body);
      response.statusCode = 204;
      return response.end();
    }

    if (request.method === 'DELETE') {
      if (!isDirectoryWritable(this.userRoot)) return sendError(response, 503, 'user data is not writable');
      const resolved = resolveExistingPath(this.userRoot, relative);
      if (!resolved) return sendError(response, 404, 'not found');
      removeContainedUserPath(this.userRoot, resolved);
      response.statusCode = 204;
      return response.end();
    }

    return sendMethodNotAllowed(response, ['GET', 'HEAD', 'PUT', 'DELETE']);
  }

  isProtectedUserPath(relative) {
    return relative.length > 0 && relative[0].toLocaleLowerCase() === 'mods';
  }

  isAuthenticated(request) {
    const authorization = request.headers.authorization;
    if (typeof authorization === 'string') {
      const match = /^Bearer ([^\s]+)$/.exec(authorization);
      if (match && tokensMatch(match[1], this.token)) return true;
    }

    const cookieToken = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    return cookieToken !== undefined && tokensMatch(cookieToken, this.token);
  }

  isRequestOriginAllowed(request) {
    const origin = request.headers.origin;
    if (origin === undefined) return true;
    try {
      return normalizeHttpOrigin(origin) === this.baseUrl;
    } catch (error) {
      return false;
    }
  }

  isGameDetected() {
    const gameKey = resolveExistingPath(this.assetRoot, ['chitin.key']);
    return Boolean(gameKey && !gameKey.stats.isDirectory());
  }

  handleUnexpectedError(response, error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message = error instanceof HttpError ? error.message : 'internal server error';
    if (!response.headersSent) {
      if (error instanceof HttpError && error.contentRange) {
        response.setHeader('Content-Range', error.contentRange);
      }
      sendError(response, statusCode, message);
    } else {
      response.destroy();
    }
  }
}

function validateDirectoryRoot(root, optionName) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new TypeError(`${optionName} must be a non-empty directory path`);
  }
  const resolvedRoot = path.resolve(root);
  let stats;
  try {
    stats = fs.statSync(resolvedRoot);
  } catch (error) {
    throw new Error(`${optionName} must reference an existing directory`);
  }
  if (!stats.isDirectory()) throw new Error(`${optionName} must reference a directory`);
  return fs.realpathSync(resolvedRoot);
}

function validateDistinctRoots(assetRoot, userRoot, distRoot) {
  const roots = [assetRoot, userRoot, distRoot];
  for (let index = 0; index < roots.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < roots.length; otherIndex += 1) {
      if (isInsideRoot(roots[index], roots[otherIndex]) || isInsideRoot(roots[otherIndex], roots[index])) {
        throw new Error('assetRoot, userRoot, and distRoot must not overlap');
      }
    }
  }
}

function validateModRoots(modRoots, assetRoot, userRoot, distRoot) {
  if (modRoots === undefined) return [];
  if (!Array.isArray(modRoots)) throw new TypeError('modRoots must be an array');
  const validatedRoots = modRoots.map((root, index) => {
    const optionName = `modRoots[${index}]`;
    const validatedRoot = validateDirectoryRoot(root, optionName);
    const override = resolveExistingPath(validatedRoot, ['Override']);
    if (!override || !override.stats.isDirectory()) {
      throw new Error(`${optionName} must contain an Override directory`);
    }
    return validatedRoot;
  });
  const protectedModArea = path.join(userRoot, 'mods');
  for (const modRoot of validatedRoots) {
    if (isInsideRoot(assetRoot, modRoot) || isInsideRoot(modRoot, assetRoot)
      || isInsideRoot(distRoot, modRoot) || isInsideRoot(modRoot, distRoot)) {
      throw new Error('mod roots must not overlap configured roots or each other');
    }
    if (isInsideRoot(userRoot, modRoot) || isInsideRoot(modRoot, userRoot)) {
      if (!isInsideRoot(protectedModArea, modRoot)) {
        throw new Error('mod roots nested under userRoot must be inside userRoot/mods');
      }
    }
  }
  for (let index = 0; index < validatedRoots.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < validatedRoots.length; otherIndex += 1) {
      if (isInsideRoot(validatedRoots[index], validatedRoots[otherIndex])
        || isInsideRoot(validatedRoots[otherIndex], validatedRoots[index])) {
        throw new Error('mod roots must not overlap configured roots or each other');
      }
    }
  }
  return Object.freeze(validatedRoots.slice());
}

function validateToken(token) {
  if (typeof token !== 'string' || token.length === 0 || /[\r\n]/.test(token)) {
    throw new TypeError('token must be a non-empty single-line string');
  }
  return token;
}

function validateLoopbackHost(host) {
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new RangeError('host must be a loopback address');
  }
  return host;
}

function validatePort(port) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError('port must be an integer between 0 and 65535');
  }
  return port;
}

function validateMaxBodyBytes(maxBodyBytes) {
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 0) {
    throw new RangeError('maxBodyBytes must be a non-negative safe integer');
  }
  return maxBodyBytes;
}

function normalizeHttpOrigin(originValue) {
  const origin = new URL(originValue);
  if (origin.protocol !== 'http:') {
    throw new TypeError('origin must use HTTP');
  }
  return origin.origin;
}

function validateBeforeFileOpen(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('onBeforeFileOpen must be a function');
  }
  return callback;
}

function parseRelativePath(rawPath) {
  if (typeof rawPath !== 'string') throw new HttpError(400, 'invalid path');
  const segments = [];
  for (const encodedSegment of rawPath.replace(/^\/+/, '').split('/')) {
    if (encodedSegment === '') continue;
    let segment;
    try {
      segment = decodeURIComponent(encodedSegment);
    } catch (error) {
      throw new HttpError(400, 'invalid path encoding');
    }
    if (
      segment === '' ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\') ||
      segment.includes('%') ||
      segment.includes('\0')
    ) {
      throw new HttpError(403, 'invalid path');
    }
    segments.push(segment);
  }
  return segments;
}

function resolveExistingPath(root, segments) {
  let currentPath = root;
  for (const segment of segments) {
    const nextPath = findExistingChild(currentPath, segment);
    if (!nextPath) return undefined;
    const realPath = fs.realpathSync(nextPath);
    if (!isInsideRoot(root, realPath)) throw new HttpError(403, 'path escapes configured root');
    currentPath = nextPath;
  }

  const realPath = fs.realpathSync(currentPath);
  if (!isInsideRoot(root, realPath)) throw new HttpError(403, 'path escapes configured root');
  return { path: currentPath, stats: fs.statSync(currentPath) };
}

function findExistingChild(parentPath, requestedName) {
  const exactPath = path.join(parentPath, requestedName);
  try {
    fs.lstatSync(exactPath);
    return exactPath;
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }

  let entries;
  try {
    entries = fs.readdirSync(parentPath);
  } catch (error) {
    if (isMissingPathError(error) || error.code === 'ENOTDIR') return undefined;
    throw error;
  }
  const matchedName = entries.find((entry) => entry.toLocaleLowerCase() === requestedName.toLocaleLowerCase());
  return matchedName === undefined ? undefined : path.join(parentPath, matchedName);
}

function resolveUserWriteTarget(root, segments) {
  let parentPath = root;
  for (const segment of segments.slice(0, -1)) {
    const existingChild = findExistingChild(parentPath, segment);
    if (existingChild) {
      const realPath = fs.realpathSync(existingChild);
      if (!isInsideRoot(root, realPath)) throw new HttpError(403, 'path escapes configured root');
      if (!fs.statSync(existingChild).isDirectory()) throw new HttpError(409, 'parent path is not a directory');
      parentPath = existingChild;
      continue;
    }

    const newDirectory = path.join(parentPath, segment);
    fs.mkdirSync(newDirectory);
    const realPath = fs.realpathSync(newDirectory);
    if (!isInsideRoot(root, realPath)) {
      throw new HttpError(403, 'path escapes configured root');
    }
    parentPath = newDirectory;
  }

  const parentStats = assertTrustedParent(root, parentPath);
  return {
    root,
    parentPath,
    parentStats,
    targetPath: path.join(parentPath, segments[segments.length - 1]),
  };
}

/**
 * Node does not expose portable directory-descriptor-relative open or rename APIs,
 * particularly on Windows. This service therefore detects parent replacement before
 * creating the temporary file and immediately before rename, then fails closed. The
 * boundary assumes no hostile local process can continuously swap directories in the
 * final syscall-sized window; a sandboxed local account is required for that threat.
 */
function atomicWriteFile(target, body) {
  assertTrustedParent(target.root, target.parentPath, target.parentStats);
  const temporaryPath = path.join(
    target.parentPath,
    `.${path.basename(target.targetPath)}.${process.pid}.${crypto.randomBytes(12).toString('hex')}.tmp`
  );

  try {
    fs.writeFileSync(temporaryPath, body, { flag: 'wx' });
    assertTrustedParent(target.root, target.parentPath, target.parentStats);
    fs.renameSync(temporaryPath, target.targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      if (!isMissingPathError(cleanupError)) throw cleanupError;
    }
    throw error;
  }
}

function assertTrustedParent(root, parentPath, expectedStats) {
  const realParentPath = fs.realpathSync(parentPath);
  if (!isInsideRoot(root, realParentPath)) throw new HttpError(403, 'path escapes configured root');
  const currentStats = fs.statSync(parentPath);
  if (expectedStats && !sameDirectoryIdentity(expectedStats, currentStats)) {
    throw new HttpError(409, 'user data parent changed during write');
  }
  return currentStats;
}

function removeContainedUserPath(root, resolved) {
  const realPath = fs.realpathSync(resolved.path);
  if (!isInsideRoot(root, realPath)) throw new HttpError(403, 'path escapes configured root');
  const currentStats = fs.statSync(resolved.path);
  if (!sameFilesystemEntryIdentity(resolved.stats, currentStats)) {
    throw new HttpError(409, 'user data path changed during delete');
  }
  if (currentStats.isDirectory()) {
    fs.rmSync(resolved.path, { recursive: true, force: false });
  } else {
    fs.unlinkSync(resolved.path);
  }
}

function sendFile(request, response, filePath, validatedStats, onBeforeFileOpen, cacheControl = 'private, max-age=3600') {
  let fileDescriptor;
  let stream;
  try {
    if (onBeforeFileOpen) onBeforeFileOpen(filePath);
    fileDescriptor = fs.openSync(filePath, 'r');
    const openedStats = fs.fstatSync(fileDescriptor);
    if (!sameFileIdentity(validatedStats, openedStats)) {
      throw new HttpError(409, 'file changed during read');
    }

    const range = parseSingleRange(request.headers.range, openedStats.size);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', cacheControl);
    response.setHeader('Content-Type', MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');

    if (range) {
      response.statusCode = 206;
      response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${openedStats.size}`);
      response.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      response.statusCode = 200;
      response.setHeader('Content-Length', String(openedStats.size));
    }

    if (request.method === 'HEAD') {
      fs.closeSync(fileDescriptor);
      fileDescriptor = undefined;
      return response.end();
    }

    const streamOptions = range
      ? { fd: fileDescriptor, autoClose: true, start: range.start, end: range.end }
      : { fd: fileDescriptor, autoClose: true };
    stream = fs.createReadStream(filePath, streamOptions);
    fileDescriptor = undefined;
    stream.on('error', () => {
      if (!response.headersSent) sendError(response, 500, 'read error');
      else response.destroy();
    });
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch (error) {
    if (fileDescriptor !== undefined) {
      try {
        fs.closeSync(fileDescriptor);
      } catch (closeError) {
        if (!isMissingPathError(closeError)) throw closeError;
      }
    }
    throw error;
  }
}

function sameFileIdentity(expectedStats, actualStats) {
  return expectedStats.isFile() &&
    actualStats.isFile() &&
    expectedStats.dev === actualStats.dev &&
    expectedStats.ino === actualStats.ino &&
    expectedStats.size === actualStats.size;
}

function sameFilesystemEntryIdentity(expectedStats, actualStats) {
  return expectedStats.dev === actualStats.dev &&
    expectedStats.ino === actualStats.ino &&
    expectedStats.isFile() === actualStats.isFile() &&
    expectedStats.isDirectory() === actualStats.isDirectory();
}

function sameDirectoryIdentity(expectedStats, actualStats) {
  return expectedStats.isDirectory() &&
    actualStats.isDirectory() &&
    expectedStats.dev === actualStats.dev &&
    expectedStats.ino === actualStats.ino;
}

function parseSingleRange(rangeHeader, size) {
  if (rangeHeader === undefined) return undefined;
  if (typeof rangeHeader !== 'string') throw invalidRangeError(size);
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match || (match[1] === '' && match[2] === '') || size === 0) {
    throw invalidRangeError(size);
  }

  let start;
  let end;
  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw invalidRangeError(size);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
      throw invalidRangeError(size);
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function invalidRangeError(size) {
  const error = new HttpError(416, 'range not satisfiable');
  error.contentRange = `bytes */${size}`;
  return error;
}

async function readRequestBody(request, maxBodyBytes) {
  const contentLength = request.headers['content-length'];
  if (typeof contentLength === 'string' && /^\d+$/.test(contentLength) && Number(contentLength) > maxBodyBytes) {
    request.resume();
    throw new HttpError(413, 'request body is too large');
  }

  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBodyBytes) {
        request.resume();
        throw new HttpError(413, 'request body is too large');
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'unable to read request body');
  }
  return Buffer.concat(chunks, size);
}

function tokensMatch(candidate, expected) {
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

function readCookie(cookieHeader, name) {
  if (typeof cookieHeader !== 'string') return undefined;
  for (const pair of cookieHeader.split(';')) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex < 1) continue;
    if (pair.slice(0, separatorIndex).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(separatorIndex + 1).trim());
    } catch (error) {
      return undefined;
    }
  }
  return undefined;
}

function isDirectoryWritable(directoryPath) {
  try {
    fs.accessSync(directoryPath, fs.constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isMissingPathError(error) {
  return Boolean(error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'));
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message) {
  return sendJson(response, statusCode, { error: message });
}

function sendMethodNotAllowed(response, allowedMethods) {
  response.setHeader('Allow', allowedMethods.join(', '));
  return sendError(response, 405, 'method not allowed');
}

module.exports = { createAssetService, normalizeHttpOrigin };
