#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const sourceRoot = path.join(__dirname, 'src');
const outputRoot = path.join(repositoryRoot, 'dist', 'xr-benchmark');

async function build() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const entries = [
    ['raw', path.join(sourceRoot, 'raw-entry.ts')],
    ['three-r149', path.join(sourceRoot, 'three-r149-entry.ts')],
    ['three-current', path.join(sourceRoot, 'three-current-entry.ts')],
  ];
  for (const [name, entryPoint] of entries) {
    await esbuild.build({
      entryPoints: [entryPoint],
      outfile: path.join(outputRoot, `${name}.js`),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: ['chrome120', 'edge120'],
      sourcemap: true,
      legalComments: 'none',
      logLevel: 'info',
    });
  }

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
  );
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    threeR149: packageJson.dependencies.three,
    threeCurrent: packageJson.devDependencies['three-current'],
    cases: entries.map(([name]) => name),
  };
  fs.writeFileSync(
    path.join(outputRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(path.join(outputRoot, 'benchmark.css'), STYLE, 'utf8');
  fs.writeFileSync(path.join(outputRoot, 'index.html'), indexHtml(), 'utf8');
  fs.writeFileSync(path.join(outputRoot, 'raw.html'), caseHtml('Raw WebXR', 'raw.js'), 'utf8');
  fs.writeFileSync(
    path.join(outputRoot, 'three-r149.html'),
    caseHtml('THREE r149', 'three-r149.js'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(outputRoot, 'three-current.html'),
    caseHtml('THREE current', 'three-current.js'),
    'utf8'
  );
  console.log(`XR benchmark written to ${outputRoot}`);
}

function caseHtml(title, script) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · KOTOR II VR benchmark</title>
  <link rel="stylesheet" href="benchmark.css">
</head>
<body>
  <div id="benchmark-root"></div>
  <script src="${escapeHtml(script)}"></script>
</body>
</html>
`;
}

function indexHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KOTOR II VR · XR renderer benchmark</title>
  <link rel="stylesheet" href="benchmark.css">
</head>
<body>
  <main class="benchmark-shell">
    <p class="eyebrow">KOTOR II VR · Phase 0</p>
    <h1>XR renderer isolation benchmark</h1>
    <p class="description">Run each case for 60 seconds with the same headset, runtime, browser, and Virtual Desktop settings.</p>
    <nav class="case-grid" aria-label="Benchmark cases">
      <a href="raw.html"><strong>Raw WebXR</strong><span>No engine or THREE</span></a>
      <a href="three-r149.html"><strong>THREE r149</strong><span>Current KotOR.js renderer version</span></a>
      <a href="three-current.html"><strong>THREE current</strong><span>Pinned comparison renderer</span></a>
    </nav>
  </main>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const STYLE = `
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #07090d; color: #eef4ff; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 20% 0%, #172238, #07090d 55%); }
.benchmark-shell { width: min(1100px, calc(100% - 40px)); margin: 0 auto; padding: 56px 0; }
.eyebrow { color: #7fb7ff; font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
h1 { margin: 8px 0 12px; font-size: clamp(34px, 5vw, 64px); line-height: 1; }
.description { max-width: 760px; color: #b7c5d9; font-size: 18px; line-height: 1.55; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 28px 0 16px; }
button, nav a { border: 1px solid #33445f; border-radius: 10px; background: #111a27; color: #eef4ff; padding: 12px 16px; font: inherit; font-weight: 700; text-decoration: none; }
button:hover:not(:disabled), nav a:hover { border-color: #75adf7; background: #17263a; }
button:disabled { opacity: .45; }
.status { min-height: 1.5em; color: #8fd8bd; }
.xr-canvas { display: block; width: min(100%, 960px); aspect-ratio: 16 / 9; border: 1px solid #243247; border-radius: 12px; background: #040509; }
.report { overflow: auto; min-height: 180px; max-height: 520px; padding: 18px; border: 1px solid #243247; border-radius: 12px; background: #090d14; color: #b9d6ff; }
nav { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
.case-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-top: 32px; }
.case-grid a { display: grid; gap: 8px; min-height: 120px; align-content: center; }
.case-grid span { color: #9cacbf; font-weight: 500; }
`;

build().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
