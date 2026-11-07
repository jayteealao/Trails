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
 * contain nothing but a single `<pre>`, AND that block's short text must read
 * as a network error. Prose that merely quotes an error string still has other
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

/**
 * Longest `<pre>` text still treated as a candidate error message.
 *
 * The proxy's error page is one short line — the observed stub's block is 66
 * characters. A legitimate plain-text document (a log, a transcript, a raw
 * `.txt` article) renders as a bare `<pre>` too, and a generic phrase such as
 * "timed out" can appear anywhere inside it, so the signature test is only
 * applied to a block short enough to be an error message rather than a
 * document in its own right.
 */
const MAX_ERROR_TEXT_LENGTH = 512;

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

/**
 * Drops elements that carry no content at all (`<div id="x"></div>`), innermost
 * first. A headless browser's plain-text render appends such empty nodes beside
 * the `<pre>` — the captured 275-byte stub ends with a hidden, empty `<div>` —
 * and they must not defeat the "nothing but a `<pre>`" structural test. Only
 * genuinely contentless elements are removed, so anything a reader would see
 * still counts against that test.
 */
function dropEmptyElements(html: string): string {
  const empty = /<([a-zA-Z][\w-]*)\b[^>]*>\s*<\/\1\s*>/g;
  let current = html;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = current.replace(empty, '');
    if (next === current) break;
    current = next;
  }
  return current;
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
 * Discriminator a renderer puts in the `reason` field of its error payload when
 * it rejects a proxy/network error page. The workflow reads it to route the
 * request to the alternate renderer, which may still reach the target.
 */
export const PROXY_ERROR_PAGE_REASON = 'proxy_error_page';

/**
 * True when `html` is not a rendered document but a proxy/network error page —
 * or is empty. Callers must fail the render step rather than archive the body.
 *
 * Empty or whitespace-only input reports true because it is likewise not a
 * document worth archiving; callers that distinguish the two cases should
 * check emptiness before calling.
 */
/**
 * Longest page the proxy-error check scans. The observed error page is 275
 * bytes, and the cap keeps the lazy regexes below from scanning a hostile page
 * many times over.
 */
const MAX_PROXY_ERROR_HTML_LENGTH = 16_384;

export function isProxyErrorPage(html: string): boolean {
  if (!html || html.trim().length === 0) return true;
  if (html.length > MAX_PROXY_ERROR_HTML_LENGTH) return false;

  const withoutNoise = extractBodyInner(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  const stripped = dropEmptyElements(withoutNoise).trim();

  const pre = /^<pre\b[^>]*>([\s\S]*?)<\/pre>$/i.exec(stripped);
  if (!pre) return false;

  const text = decodeEntities(pre[1] ?? '').trim();
  if (text.length > MAX_ERROR_TEXT_LENGTH) return false;
  return NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

/** Markers a bot-wall vendor puts in the markup of its challenge page. */
const CHALLENGE_MARKERS: readonly RegExp[] = [
  /window\._cf_chl_opt\b/, // Cloudflare managed challenge
  /\/cdn-cgi\/challenge-platform\/h\/[a-z]\/orchestrate\//, // Cloudflare challenge orchestrator (never the scripts/jsd injector)
  /\bid=["']challenge-error-text["']/, // Cloudflare challenge page
  /captcha-delivery\.com/, // DataDome challenge host
  /\bpx-captcha\b/, // PerimeterX challenge
];

/** Longest visible text still treated as an interstitial; the largest sample had 489 chars. */
const MAX_CHALLENGE_TEXT_LENGTH = 2000;

/**
 * Discriminator a worker puts in the `reason` field of its error payload when
 * the target site blocked access (a challenge page or a 401/403 navigation).
 */
export const ACCESS_BLOCKED_REASON = 'access_blocked';

/** Elements whose content a reader never sees as text. */
const HIDDEN_ELEMENTS: ReadonlySet<string> = new Set(['script', 'style', 'noscript', 'template']);

interface ScannedPage {
  /** Every tag and every script body: the markup a vendor plants, never the text a writer quotes. */
  structure: string;
  /** Text a reader would see in the body, with entities decoded and whitespace collapsed. */
  visibleText: string;
}

/**
 * One forward pass over the page. Every search starts where the last one
 * ended, so a hostile page (thousands of unclosed tags or comments) costs time
 * linear in its length.
 */
function scanPage(html: string): ScannedPage {
  const lower = html.toLowerCase();
  const structure: string[] = [];
  const text: string[] = [];
  const bodyStart = lower.indexOf('<body');
  const bodyEnd = lower.lastIndexOf('</body');
  let i = 0;

  while (i < html.length) {
    const inBody = bodyStart === -1 || (i > bodyStart && (bodyEnd === -1 || i < bodyEnd));
    const lt = html.indexOf('<', i);
    const textEnd = lt === -1 ? html.length : lt;
    if (inBody && textEnd > i) text.push(html.slice(i, textEnd));
    if (lt === -1) break;

    if (lower.startsWith('<!--', lt)) {
      const end = lower.indexOf('-->', lt + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    if (!/[a-z!/]/.test(lower[lt + 1] ?? '')) {
      if (inBody) text.push('<');
      i = lt + 1;
      continue;
    }

    const gt = html.indexOf('>', lt);
    if (gt === -1) break;
    structure.push(html.slice(lt, gt + 1));
    text.push(' ');
    i = gt + 1;

    const name = /^<([a-z][\w-]*)/.exec(lower.slice(lt, Math.min(gt + 1, lt + 32)))?.[1];
    if (name === undefined || !HIDDEN_ELEMENTS.has(name)) continue;
    const close = lower.indexOf(`</${name}`, i);
    if (close === -1) break;
    if (name === 'script') structure.push(html.slice(i, close));
    const closeEnd = html.indexOf('>', close);
    if (closeEnd === -1) break;
    i = closeEnd + 1;
  }

  return {
    structure: structure.join('\n'),
    visibleText: decodeEntities(text.join('')).replace(/\s+/g, ' ').trim()
  };
}

/**
 * True when `html` is a bot-wall interstitial that a site served with HTTP 200
 * in place of the page. Callers must not archive it.
 *
 * Two signals must both hold: a known challenge-vendor marker in the markup (a
 * tag or a script body, never a text node, so an article that quotes the
 * markers is not flagged), and a near-empty visible body (an ordinary page that
 * loads a vendor sensor script still has its article text).
 */
export function isChallengePage(html: string): boolean {
  // Cheap first pass on the raw page: most pages carry no marker at all.
  if (!CHALLENGE_MARKERS.some((marker) => marker.test(html))) return false;
  const { structure, visibleText } = scanPage(html);
  if (!CHALLENGE_MARKERS.some((marker) => marker.test(structure))) return false;
  return visibleText.length <= MAX_CHALLENGE_TEXT_LENGTH;
}

/**
 * The answer of a worker when the target site blocked access. A worker answers
 * a site block with `403`, so the workflow records `ACCESS_BLOCKED`.
 */
export function accessBlockedResponse(url: string, navigationStatus?: number): Response {
  return Response.json(
    {
      error: 'Target page blocked access',
      reason: ACCESS_BLOCKED_REASON,
      url,
      ...(navigationStatus === undefined ? {} : { navigationStatus }),
    },
    { status: 403 },
  );
}

/** Reason a worker gives when Browser Rendering rejected its API token. */
export const BROWSER_TOKEN_INVALID_REASON = 'browser_token_invalid';

/** Cloudflare API error codes for a rejected or missing token. */
const AUTH_ERROR_CODES = new Set([10000, 9109]);
const AUTH_ERROR_MESSAGE = /authentication error|invalid (?:api |access )?token/i;

function isAuthErrorEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const code = 'code' in entry ? Number(entry.code) : Number.NaN;
  const message = 'message' in entry && typeof entry.message === 'string' ? entry.message : '';
  return AUTH_ERROR_CODES.has(code) || AUTH_ERROR_MESSAGE.test(message);
}

/**
 * True when a Browser Rendering REST answer rejects the API token itself
 * (401/403 with a Cloudflare authentication error), not the target page.
 */
export function isBrowserRenderingAuthError(status: number, body: string): boolean {
  if (status !== 401 && status !== 403) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not a Cloudflare API error body, so not a token rejection.
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || !('errors' in parsed)) return false;
  return Array.isArray(parsed.errors) && parsed.errors.some(isAuthErrorEntry);
}
