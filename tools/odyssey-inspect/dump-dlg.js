/**
 * Prints one conversation as a readable tree: which start node each condition
 * selects, what each entry says, and which script every node runs.
 *
 *   node tools/odyssey-inspect/dump-dlg.js <module> <dlg-resref>
 *
 * Conditional and action scripts in TSL carry their arguments on the *node*
 * (ParamStrA/Param1/...), not in the script, so those are printed inline —
 * without them "c_global_eq" says nothing about which global is being tested.
 */
const { findResource, readGff, tlk } = require('./formats');

function nodeText(node) {
  const t = node.Text;
  if (!t) return '';
  return (t.strings && t.strings[0]) || tlk(t.strref) || '';
}

function scriptOf(node, which) {
  const name = which === 1 ? node.Script : node.Script2;
  if (!name) return null;
  const params = which === 1
    ? { str: node.ParamStrA, p: [node.Param1, node.Param2, node.Param3, node.Param4, node.Param5] }
    : { str: node.ParamStrB, p: [node.Param1b, node.Param2b, node.Param3b, node.Param4b, node.Param5b] };
  return `${name}(${JSON.stringify(params.str || '')}, ${params.p.map((v) => v == null ? 0 : v).join(',')})`;
}

function conditionOf(link, which) {
  const name = which === 1 ? link.Active : link.Active2;
  if (!name) return null;
  const params = which === 1
    ? { str: link.ParamStrA, p: [link.Param1, link.Param2, link.Param3, link.Param4, link.Param5], not: link.Not }
    : { str: link.ParamStrB, p: [link.Param1b, link.Param2b, link.Param3b, link.Param4b, link.Param5b], not: link.Not2 };
  return `${params.not ? 'NOT ' : ''}${name}(${JSON.stringify(params.str || '')}, ${params.p.map((v) => v == null ? 0 : v).join(',')})`;
}

function describeLink(link) {
  const conditions = [conditionOf(link, 1), conditionOf(link, 2)].filter(Boolean);
  return `${link.Index}${conditions.length ? ` [if ${conditions.join(' AND ')}]` : ''}`;
}

function main() {
  const [moduleName, resref] = process.argv.slice(2);
  if (!moduleName || !resref) throw new Error('usage: dump-dlg.js <module> <dlg-resref>');
  const found = findResource(moduleName, resref, 2029);
  if (!found) throw new Error(`no dialogue "${resref}" in module ${moduleName}`);
  const dlg = readGff(found.data);
  const entries = dlg.EntryList || [];
  const replies = dlg.ReplyList || [];

  console.log(`# ${resref}.dlg (${found.container}) — ${entries.length} entries, ${replies.length} replies\n`);
  console.log('## Start nodes, in evaluation order');
  for (const [i, link] of (dlg.StartingList || []).entries()) {
    console.log(`  start[${i}] -> entry ${describeLink(link)}`);
  }

  const dump = (label, list, linkField) => {
    console.log(`\n## ${label}`);
    for (const [i, node] of list.entries()) {
      const scripts = [scriptOf(node, 1), scriptOf(node, 2)].filter(Boolean);
      console.log(`  ${label.toLowerCase().slice(0, -1)}[${i}]${scripts.length ? ` runs ${scripts.join(' then ')}` : ''}`);
      const text = nodeText(node);
      if (text) console.log(`      "${text.replace(/\s+/g, ' ').slice(0, 220)}"`);
      const links = node[linkField] || [];
      console.log(`      -> ${links.length ? links.map(describeLink).join(' | ') : '(ends)'}`);
    }
  };
  dump('Entries', entries, 'RepliesList');
  dump('Replies', replies, 'EntriesList');
}

main();
