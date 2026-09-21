const { parse, serializeOuter } = require('parse5');

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const JAVASCRIPT_TYPES = new Set([
  '', 'module', 'application/ecmascript', 'application/javascript',
  'application/x-ecmascript', 'application/x-javascript', 'text/ecmascript',
  'text/javascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2',
  'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5', 'text/jscript',
  'text/livescript', 'text/x-ecmascript', 'text/x-javascript',
]);

/** Parse with browser HTML rules; comments, data-src, and templates are inert. */
function rewriteRuntimeDocument(document, documentUrl, bundle) {
  const tree = parse(document, { sourceCodeLocationInfo: true, scriptingEnabled: true });
  const elements = [];
  const visit = (node) => {
    if (node.tagName && node.namespaceURI === HTML_NAMESPACE) elements.push(node);
    // Template contents live in a separate fragment and never execute during
    // document parsing. Do not traverse node.content.
    for (const child of node.childNodes || []) visit(child);
  };
  visit(tree);
  const attributes = (node) => Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
  const pageUrl = new URL(documentUrl);
  const base = elements.find((node) => node.tagName === 'base' && Object.hasOwn(attributes(node), 'href'));
  let baseUrl;
  try { baseUrl = base ? new URL(attributes(base).href, pageUrl) : pageUrl; } catch { return null; }
  if (baseUrl.origin !== pageUrl.origin) return null;
  const scripts = [];
  for (const node of elements) {
    if (node.tagName !== 'script') continue;
    const attrs = attributes(node);
    const type = (attrs.type === undefined && attrs.language ? `text/${attrs.language}` : attrs.type || '').trim().toLowerCase();
    if (!JAVASCRIPT_TYPES.has(type) || (type !== 'module' && Object.hasOwn(attrs, 'nomodule')) || !Object.hasOwn(attrs, 'src')) continue;
    let source;
    try { source = new URL(attrs.src, baseUrl); } catch { continue; }
    let pathname;
    try { pathname = decodeURIComponent(source.pathname); } catch { return null; }
    if (/\/KotOR\.js$/i.test(pathname)) scripts.push({ node, source });
  }
  if (scripts.length !== 1) return null;
  const { node, source } = scripts[0];
  const location = node.sourceCodeLocation;
  if (source.href !== new URL('/KotOR.js', pageUrl).href || !location || !location.startTag || !location.endTag) return null;
  node.attrs = node.attrs.filter(({ name }) => !['src', 'integrity', 'crossorigin'].includes(name));
  node.attrs.push(
    { name: 'src', value: `/bundles/${bundle.sha256}/KotOR.js` },
    { name: 'integrity', value: bundle.integrity },
    { name: 'crossorigin', value: 'anonymous' },
  );
  return document.slice(0, location.startOffset) + serializeOuter(node) + document.slice(location.endOffset);
}

module.exports = { rewriteRuntimeDocument };
