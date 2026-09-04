/**
 * Rendered-content validation shared by every renderer.
 *
 * Headless browsers render a non-HTML upstream response (a proxy's plain-text
 * network error) as a document whose body holds nothing but a `<pre>` block.
 * Such a page arrives with HTTP 200 and a non-empty body, so a length check
 * alone accepts it: the observed stub is 275 bytes, and any threshold high
 * enough to reject it would also reject legitimately short articles.
 *
 * Detection is therefore structural first, signature second: the body must
 * contain nothing but a single `<pre>`, AND that block's text must read as a
 * network error. Prose that merely quotes an error string still has other
 * markup around it and is accepted.
 */

const NETWORK_ERROR_PATTERNS: readonly RegExp[] = [
  /dial tcp\b/i,
  /no such host\b/i,
  /\bERR_[A-Z][A-Z_]{2,}/,
  /connection refused\b/i,
  /connection reset\b/i,
  /connection closed\b/i,
  /timed out\b/i,
];

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

/** Inner HTML of `<body>`, or the whole document with the shell elements dropped. */
function extractBodyInner(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (body) return body[1] ?? html;
  return html
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?html\b[^>]*>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '');
}

/**
 * True when `html` is not a rendered document but a proxy/network error page —
 * or is empty. Callers must fail the render step rather than archive the body.
 *
 * Empty or whitespace-only input reports true because it is likewise not a
 * document worth archiving; callers that distinguish the two cases should
 * check emptiness before calling.
 */
export function isProxyErrorPage(html: string): boolean {
  if (!html || html.trim().length === 0) return true;

  const stripped = extractBodyInner(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .trim();

  const pre = /^<pre\b[^>]*>([\s\S]*?)<\/pre>$/i.exec(stripped);
  if (!pre) return false;

  const text = decodeEntities(pre[1] ?? '').trim();
  return NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}
