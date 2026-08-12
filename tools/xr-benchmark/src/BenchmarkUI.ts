import type { XRBenchmarkReport } from '../../../src/vr/benchmark/XRBenchmarkMetrics';

export interface BenchmarkHooks {
  setStatus(message: string): void;
  publishReport(report: XRBenchmarkReport): void;
}

export type BenchmarkStarter = (hooks: BenchmarkHooks) => Promise<() => Promise<void>>;

export interface BenchmarkPageOptions {
  title: string;
  description: string;
  start: BenchmarkStarter;
}

export async function mountBenchmarkPage(options: BenchmarkPageOptions): Promise<void> {
  const root = document.getElementById('benchmark-root');
  if (!root) throw new Error('Missing #benchmark-root host element');

  root.innerHTML = `
    <main class="benchmark-shell">
      <p class="eyebrow">KOTOR II VR · Phase 0</p>
      <h1></h1>
      <p class="description"></p>
      <div class="actions">
        <button type="button" data-action="enter">Enter VR and measure 60 seconds</button>
        <button type="button" data-action="exit" disabled>Exit VR</button>
        <button type="button" data-action="copy" disabled>Copy JSON</button>
        <button type="button" data-action="download" disabled>Download JSON</button>
      </div>
      <p class="status" role="status">Checking immersive WebXR support…</p>
      <canvas class="xr-canvas"></canvas>
      <pre class="report" aria-label="Benchmark report">No report yet.</pre>
      <nav aria-label="Benchmark cases">
        <a href="raw.html">Raw WebXR</a>
        <a href="three-r149.html">THREE r149</a>
        <a href="three-current.html">THREE current</a>
      </nav>
    </main>`;

  const heading = requireElement<HTMLHeadingElement>(root, 'h1');
  const description = requireElement<HTMLParagraphElement>(root, '.description');
  const status = requireElement<HTMLParagraphElement>(root, '.status');
  const reportOutput = requireElement<HTMLPreElement>(root, '.report');
  const enterButton = requireElement<HTMLButtonElement>(root, '[data-action="enter"]');
  const exitButton = requireElement<HTMLButtonElement>(root, '[data-action="exit"]');
  const copyButton = requireElement<HTMLButtonElement>(root, '[data-action="copy"]');
  const downloadButton = requireElement<HTMLButtonElement>(root, '[data-action="download"]');
  heading.textContent = options.title;
  description.textContent = options.description;

  let stopRun: (() => Promise<void>) | null = null;
  let latestReport: XRBenchmarkReport | null = null;
  const setStatus = (message: string): void => {
    status.textContent = message;
  };
  const publishReport = (report: XRBenchmarkReport): void => {
    latestReport = report;
    reportOutput.textContent = JSON.stringify(report, null, 2);
    copyButton.disabled = false;
    downloadButton.disabled = false;
  };

  enterButton.addEventListener('click', async () => {
    if (stopRun) return;
    enterButton.disabled = true;
    setStatus('Requesting immersive VR session…');
    try {
      stopRun = await options.start({ setStatus, publishReport });
      exitButton.disabled = false;
    } catch (error) {
      setStatus(`Unable to start: ${formatError(error)}`);
      enterButton.disabled = false;
    }
  });

  exitButton.addEventListener('click', async () => {
    const stop = stopRun;
    if (!stop) return;
    exitButton.disabled = true;
    try {
      await stop();
    } catch (error) {
      setStatus(`Unable to stop cleanly: ${formatError(error)}`);
    } finally {
      stopRun = null;
      enterButton.disabled = false;
    }
  });

  copyButton.addEventListener('click', async () => {
    if (!latestReport) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(latestReport, null, 2));
      setStatus('Report copied to the clipboard.');
    } catch (error) {
      setStatus(`Clipboard write failed: ${formatError(error)}`);
    }
  });

  downloadButton.addEventListener('click', () => {
    if (!latestReport) return;
    const blob = new Blob([JSON.stringify(latestReport, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kotor2-vr-${latestReport.caseId}-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  const xr = navigator.xr;
  if (!xr) {
    setStatus('WebXR is unavailable in this browser. Use the supported Chrome/Edge profile.');
    enterButton.disabled = true;
    return;
  }
  try {
    const supported = await xr.isSessionSupported('immersive-vr');
    setStatus(
      supported
        ? 'Immersive VR is available. Keep VDXR and the headset connected.'
        : 'No immersive VR device is currently available.'
    );
    enterButton.disabled = !supported;
  } catch (error) {
    setStatus(`WebXR support check failed: ${formatError(error)}`);
    enterButton.disabled = true;
  }
}

export function benchmarkCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>('.xr-canvas');
  if (!canvas) throw new Error('Missing benchmark canvas');
  return canvas;
}

function requireElement<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing benchmark UI element: ${selector}`);
  return element;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
