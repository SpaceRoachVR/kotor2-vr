/**
 * Ranks TSL routines that retail scripts call but neither routine table implements.
 * A TSL entry counts as implemented when it has an action, or borrows K1's under
 * the same name (the rule at the bottom of NWScriptDefK2.ts).
 *
 *   node tools/parity/routine_coverage.js <repo-root> tools/parity/out/routine_usage.json
 */
const fs = require('fs');
// Split each routine table into "  <id>:{" blocks, then read name and whether action is undefined.
function parse(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = {};
  const starts = [...src.matchAll(/\r?\n\s{2}(\d+):\s?\{/g)];
  starts.forEach((m, i) => {
    const body = src.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : src.length);
    const name = /name:\s?['"]([^'"]+)['"]/.exec(body);
    const action = /\baction:\s?(\S+)/.exec(body);
    if (name) out[m[1]] = { name: name[1], impl: !!action && !action[1].startsWith('undefined') };
  });
  return out;
}
const root = process.argv[2];
const k1 = parse(root + '/src/nwscript/NWScriptDefK1.ts');
const k2 = parse(root + '/src/nwscript/NWScriptDefK2.ts');
const use = JSON.parse(fs.readFileSync(process.argv[3])).routines;
const rows = [];
for (const id in k2) {
  const ok = k2[id].impl || (k1[id] && k1[id].name === k2[id].name && k1[id].impl);
  if (!ok && use[id]) rows.push([use[id].calls, use[id].scripts, id, k2[id].name, use[id].examples.slice(0, 4).join(' ')]);
}
rows.sort((a, b) => b[0] - a[0]);
console.log('k1 parsed', Object.keys(k1).length, 'k2 parsed', Object.keys(k2).length);
console.log('called+unimplemented:', rows.length, 'total calls', rows.reduce((a, r) => a + r[0], 0));
rows.forEach((r) => console.log(r.join('\t')));
