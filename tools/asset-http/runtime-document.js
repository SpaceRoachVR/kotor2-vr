const { parse, serializeOuter } = require('parse5');

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const JAVASCRIPT_TYPES = new Set([
  'application/ecmascript', 'application/javascript',
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
  // Tree construction may move elements (for example malformed head/table
  // content). Resource URLs are resolved when their tokens are parsed, so use
  // source positions rather than the final tree's order.
  elements.sort((left, right) => (left.sourceCodeLocation?.startOffset ?? Infinity)
    - (right.sourceCodeLocation?.startOffset ?? Infinity));
  const attributes = (node) => Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
  const pageUrl = new URL(documentUrl);
  let baseUrl = pageUrl;
  let baseSeen = false;
  const scripts = [];
  for (const node of elements) {
    const attrs = attributes(node);
    if (node.tagName === 'base' && !baseSeen && Object.hasOwn(attrs, 'href')) {
      // Only the first base with href participates. An invalid or forbidden
      // base URL uses the document fallback; later bases do not replace it.
      baseSeen = true;
      try {
        const candidate = new URL(attrs.href, pageUrl);
        if (!['data:', 'javascript:'].includes(candidate.protocol)) baseUrl = candidate;
      } catch { baseUrl = pageUrl; }
    }
    if (node.tagName !== 'script') continue;
    const type = (attrs.type === undefined && attrs.language ? `text/${attrs.language}` : attrs.type || '').trim().toLowerCase();
    const mimeEssence = type.split(';', 1)[0].trim();
    const executable = type === '' || type === 'module' || JAVASCRIPT_TYPES.has(mimeEssence);
    if (!executable || (type !== 'module' && Object.hasOwn(attrs, 'nomodule')) || !Object.hasOwn(attrs, 'src')) continue;
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
