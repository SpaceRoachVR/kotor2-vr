import { execFile } from 'child_process';
import { access, readFile } from 'fs/promises';
import * as path from 'path';

export type XRBrowser = 'chrome' | 'edge';
export type XRRuntimeKind = 'steamvr' | 'vdxr' | 'unknown';

export interface XRRuntimePreflightRequest {
  readonly browser: XRBrowser;
  readonly expectedRuntime: XRRuntimeKind;
}

export interface XRRuntimePreflightIssue {
  readonly code:
    | 'unsupported-platform'
    | 'active-runtime-missing'
    | 'registry-view-mismatch'
    | 'runtime-manifest-unreadable'
    | 'runtime-unrecognized'
    | 'runtime-mismatch'
    | 'browser-missing';
  readonly message: string;
}

export interface XRRuntimePreflightResult {
  readonly ready: boolean;
  readonly activeRuntime: {
    readonly kind: XRRuntimeKind;
    readonly manifestPath: string | null;
    readonly displayName: string | null;
  };
  readonly browser: {
    readonly kind: XRBrowser;
    readonly found: boolean;
    readonly executablePath: string | null;
  };
  readonly issues: readonly XRRuntimePreflightIssue[];
}

export interface XRRuntimePreflightDependencies {
  readonly platform: NodeJS.Platform;
  readonly environment: Readonly<Record<string, string | undefined>>;
  queryRegistryValue(key: string, name: string): Promise<string | null>;
  readTextFile(filePath: string): Promise<string>;
  fileExists(filePath: string): Promise<boolean>;
}

const OPENXR_NATIVE_KEY = 'HKLM\\SOFTWARE\\Khronos\\OpenXR\\1';
const OPENXR_WOW64_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Khronos\\OpenXR\\1';
const ACTIVE_RUNTIME_VALUE = 'ActiveRuntime';

/** Read-only Windows launcher preflight. It never writes registry or runtime state. */
export class WindowsXRRuntimePreflight {
  constructor(private readonly dependencies: XRRuntimePreflightDependencies = systemDependencies()) {}

  async inspect(request: XRRuntimePreflightRequest): Promise<XRRuntimePreflightResult> {
    validateRequest(request);
    const issues: XRRuntimePreflightIssue[] = [];
    if (this.dependencies.platform !== 'win32') {
      issues.push({
        code: 'unsupported-platform',
        message: `OpenXR launcher preflight supports Windows only; detected ${this.dependencies.platform}.`,
      });
    }

    const [nativeManifest, wow64Manifest] = await Promise.all([
      this.dependencies.queryRegistryValue(OPENXR_NATIVE_KEY, ACTIVE_RUNTIME_VALUE),
      this.dependencies.queryRegistryValue(OPENXR_WOW64_KEY, ACTIVE_RUNTIME_VALUE),
    ]);
    const manifestPath = nativeManifest ?? wow64Manifest;
    if (!manifestPath) {
      issues.push({
        code: 'active-runtime-missing',
        message: 'Windows does not report an active OpenXR runtime in either registry view.',
      });
    } else if (nativeManifest && wow64Manifest && normalizePath(nativeManifest) !== normalizePath(wow64Manifest)) {
      issues.push({
        code: 'registry-view-mismatch',
        message: `64-bit and 32-bit OpenXR registry views disagree (${nativeManifest} vs ${wow64Manifest}).`,
      });
    }

    const runtime = await this.readRuntime(manifestPath, issues);
    if (manifestPath && runtime.kind === 'unknown') {
      issues.push({
        code: 'runtime-unrecognized',
        message: `The active OpenXR manifest at ${manifestPath} is not recognized as SteamVR or VDXR.`,
      });
    } else if (
      manifestPath !== null &&
      request.expectedRuntime !== 'unknown' &&
      runtime.kind !== request.expectedRuntime
    ) {
      issues.push({
        code: 'runtime-mismatch',
        message: `Expected ${request.expectedRuntime}, but Windows reports ${runtime.kind} as the active OpenXR runtime.`,
      });
    }

    const browserPath = await this.findBrowser(request.browser);
    if (!browserPath) {
      issues.push({
        code: 'browser-missing',
        message: `${request.browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome'} was not found in a standard install location.`,
      });
    }

    return {
      ready: issues.length === 0,
      activeRuntime: {
        kind: runtime.kind,
        manifestPath,
        displayName: runtime.displayName,
      },
      browser: {
        kind: request.browser,
        found: browserPath !== null,
        executablePath: browserPath,
      },
      issues,
    };
  }

  private async readRuntime(
    manifestPath: string | null,
    issues: XRRuntimePreflightIssue[],
  ): Promise<{ kind: XRRuntimeKind; displayName: string | null }> {
    if (!manifestPath) return { kind: 'unknown', displayName: null };
    try {
      const manifest = JSON.parse(await this.dependencies.readTextFile(manifestPath)) as unknown;
      const record = isRecord(manifest) ? manifest : {};
      const runtime = isRecord(record.runtime) ? record.runtime : {};
      const displayName = stringOrNull(runtime.name);
      const identity = [manifestPath, displayName, stringOrNull(runtime.library_path)]
        .filter((value): value is string => value !== null)
        .join(' ')
        .toLowerCase();
      return { kind: classifyRuntime(identity), displayName };
    } catch (error) {
      issues.push({
        code: 'runtime-manifest-unreadable',
        message: `The active OpenXR runtime manifest could not be read: ${errorMessage(error)}.`,
      });
      return { kind: classifyRuntime(manifestPath.toLowerCase()), displayName: null };
    }
  }

  private async findBrowser(browser: XRBrowser): Promise<string | null> {
    for (const candidate of browserCandidates(browser, this.dependencies.environment)) {
      if (await this.dependencies.fileExists(candidate)) return candidate;
    }
    return null;
  }
}

function validateRequest(request: XRRuntimePreflightRequest): void {
  if (request.browser !== 'chrome' && request.browser !== 'edge') {
    throw new Error(`Unsupported XR browser: ${String(request.browser)}`);
  }
  if (!['steamvr', 'vdxr', 'unknown'].includes(request.expectedRuntime)) {
    throw new Error(`Unsupported expected XR runtime: ${String(request.expectedRuntime)}`);
  }
}

function browserCandidates(
  browser: XRBrowser,
  environment: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const roots = [environment.PROGRAMFILES, environment['PROGRAMFILES(X86)'], environment.LOCALAPPDATA]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const suffix = browser === 'edge'
    ? ['Microsoft', 'Edge', 'Application', 'msedge.exe']
    : ['Google', 'Chrome', 'Application', 'chrome.exe'];
  return roots.map((root) => path.win32.join(root, ...suffix));
}

function classifyRuntime(identity: string): XRRuntimeKind {
  if (/steamvr|steamxr|vrclient/.test(identity)) return 'steamvr';
  if (/virtual\s*desktop|vdxr/.test(identity)) return 'vdxr';
  return 'unknown';
}

function normalizePath(filePath: string): string {
  return path.win32.normalize(filePath).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function systemDependencies(): XRRuntimePreflightDependencies {
  return {
    platform: process.platform,
    environment: process.env,
    queryRegistryValue,
    readTextFile: (filePath) => readFile(filePath, 'utf8'),
    fileExists: async (filePath) => {
      try {
        await access(filePath);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function queryRegistryValue(key: string, name: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', key, '/v', name], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.includes(name));
      const match = line?.match(/REG_\w+\s+(.+?)\s*$/i);
      resolve(match?.[1]?.trim() || null);
    });
  });
}
