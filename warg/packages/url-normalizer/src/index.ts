/**
 * URL normalization for deduplication, byte-identical to the app's Kotlin
 * `normalizeUrl` (android/app/src/main/java/com/jayteealao/trails/common/UrlNormalizer.kt).
 *
 * The Kotlin function parses with OkHttp's `HttpUrl`, so the parsing and
 * canonicalization below follow OkHttp's `HttpUrl.Builder.parse`,
 * `internal/url/-Url.kt` and `internal/-HostnamesCommon.kt` (OkHttp 5.x,
 * Apache-2.0, Copyright Square, Inc.) step for step. WHATWG `URL` is not used for
 * parsing: it accepts other schemes, encodes queries and paths differently and
 * rewrites numeric IPv4 hosts.
 *
 * The shared fixture file `fixtures/url-normalizer-cases.json` is the parity
 * contract; the Android unit test proves its expected values.
 */
import { domainToASCII } from 'node:url';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref_src',
  'ref_url'
]);

const HEX_DIGITS = '0123456789ABCDEF';
const USERNAME_ENCODE_SET = ' "\':;<=>@[]^`{}|/\\?#';
const PASSWORD_ENCODE_SET = ' "\':;<=>@[]^`{}|/\\?#';
const PATH_SEGMENT_ENCODE_SET = ' "<>^`{}|/\\?#';
const QUERY_ENCODE_SET = ' "\'<>#';
const QUERY_COMPONENT_REENCODE_SET = ' "\'<>#&=';
const QUERY_COMPONENT_ENCODE_SET = ' !"#$&\'(),/:;<=>?@[]\\^`{|}~';

/**
 * Normalizes a URL for deduplication: lower-cases scheme and host, strips
 * tracking query parameters and the fragment, sorts the remaining parameters by
 * name, and removes one trailing slash from a non-root path. Returns the input
 * unchanged when it is not an http or https URL that OkHttp can parse. Never throws.
 */
export function normalizeUrl(url: string): string {
  try {
    return normalize(url);
  } catch {
    return url;
  }
}

function normalize(input: string): string {
  const parsed = parse(input);
  if (parsed === null) return input;

  // Distinct decoded names in first-seen order (Kotlin's LinkedHashSet), each with its values.
  const byName = new Map<string, Array<string | null>>();
  if (parsed.query !== null) {
    for (let i = 0; i < parsed.query.length; i += 2) {
      const name = percentDecode(
        parsed.query[i] as string,
        0,
        (parsed.query[i] as string).length,
        true
      );
      const encodedValue = parsed.query[i + 1];
      const value =
        encodedValue === null || encodedValue === undefined
          ? null
          : percentDecode(encodedValue, 0, encodedValue.length, true);
      const values = byName.get(name);
      if (values) values.push(value);
      else byName.set(name, [value]);
    }
  }
  const params: Array<[string, string | null]> = [];
  for (const [name, values] of byName) {
    if (TRACKING_PARAMS.has(name.toLowerCase())) continue;
    for (const value of values) params.push([name, value]);
  }
  // Stable sort by UTF-16 code units, as Kotlin's String.compareTo.
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  let segments = parsed.segments;
  const encodedPath = '/' + segments.join('/');
  if (encodedPath !== '/' && encodedPath.endsWith('/')) {
    segments = [''];
    const trimmed = encodedPath.slice(0, -1);
    resolvePath(segments, trimmed, 0, trimmed.length);
  }

  let out = parsed.scheme + '://';
  if (parsed.username !== '' || parsed.password !== '') {
    out += parsed.username;
    if (parsed.password !== '') out += ':' + parsed.password;
    out += '@';
  }
  out += parsed.host.includes(':') ? '[' + parsed.host + ']' : parsed.host;
  if (parsed.port !== defaultPort(parsed.scheme)) out += ':' + parsed.port;
  out += '/' + segments.join('/');
  if (params.length > 0) {
    out +=
      '?' +
      params
        .map(([name, value]) =>
          value === null
            ? canonicalize(
                name,
                0,
                name.length,
                QUERY_COMPONENT_REENCODE_SET,
                true,
                true
              )
            : canonicalize(
                name,
                0,
                name.length,
                QUERY_COMPONENT_ENCODE_SET,
                false,
                true
              ) +
              '=' +
              canonicalize(
                value,
                0,
                value.length,
                QUERY_COMPONENT_ENCODE_SET,
                false,
                true
              )
        )
        .join('&');
  }
  return out;
}

interface ParsedUrl {
  scheme: 'http' | 'https';
  username: string;
  password: string;
  host: string;
  port: number;
  segments: string[];
  /** Alternating encoded names and values (null for a name without "="), or null for no query. */
  query: Array<string | null> | null;
}

/** OkHttp `HttpUrl.Builder.parse(null, input)`; null where OkHttp throws. */
function parse(input: string): ParsedUrl | null {
  let pos = indexOfFirstNonAsciiWhitespace(input);
  const limit = indexOfLastNonAsciiWhitespace(input, pos);

  // Scheme.
  if (schemeDelimiterOffset(input, pos, limit) === -1) return null;
  let scheme: 'http' | 'https';
  if (startsWithIgnoreCase(input, 'https:', pos)) {
    scheme = 'https';
    pos += 'https:'.length;
  } else if (startsWithIgnoreCase(input, 'http:', pos)) {
    scheme = 'http';
    pos += 'http:'.length;
  } else {
    return null;
  }

  // Authority. With no base URL, an authority is always read.
  let username = '';
  let password = '';
  let hasUsername = false;
  let hasPassword = false;
  let host: string | null;
  let port: number;
  pos += slashCount(input, pos, limit);
  for (;;) {
    const componentDelimiterOffset = delimiterOffset(
      input,
      '@/\\?#',
      pos,
      limit
    );
    if (
      componentDelimiterOffset !== limit &&
      input[componentDelimiterOffset] === '@'
    ) {
      // User info precedes.
      if (!hasPassword) {
        const passwordColonOffset = delimiterOffset(
          input,
          ':',
          pos,
          componentDelimiterOffset
        );
        const canonicalUsername = canonicalize(
          input,
          pos,
          passwordColonOffset,
          USERNAME_ENCODE_SET,
          true,
          false
        );
        username = hasUsername
          ? username + '%40' + canonicalUsername
          : canonicalUsername;
        if (passwordColonOffset !== componentDelimiterOffset) {
          hasPassword = true;
          password = canonicalize(
            input,
            passwordColonOffset + 1,
            componentDelimiterOffset,
            PASSWORD_ENCODE_SET,
            true,
            false
          );
        }
        hasUsername = true;
      } else {
        password =
          password +
          '%40' +
          canonicalize(
            input,
            pos,
            componentDelimiterOffset,
            PASSWORD_ENCODE_SET,
            true,
            false
          );
      }
      pos = componentDelimiterOffset + 1;
    } else {
      // Host info precedes.
      const portColon = portColonOffset(input, pos, componentDelimiterOffset);
      host = toCanonicalHost(percentDecode(input, pos, portColon, false));
      if (portColon + 1 < componentDelimiterOffset) {
        port = parsePort(input, portColon + 1, componentDelimiterOffset);
        if (port === -1) return null;
      } else {
        port = defaultPort(scheme);
      }
      if (host === null) return null;
      pos = componentDelimiterOffset;
      break;
    }
  }

  // Path.
  const segments = [''];
  const pathDelimiterOffset = delimiterOffset(input, '?#', pos, limit);
  resolvePath(segments, input, pos, pathDelimiterOffset);
  pos = pathDelimiterOffset;

  // Query. The fragment is dropped by the normalizer, so it is not parsed.
  let query: Array<string | null> | null = null;
  if (pos < limit && input[pos] === '?') {
    const queryDelimiterOffset = delimiterOffset(input, '#', pos, limit);
    query = toQueryNamesAndValues(
      canonicalize(
        input,
        pos + 1,
        queryDelimiterOffset,
        QUERY_ENCODE_SET,
        true,
        true
      )
    );
  }

  return { scheme, username, password, host, port, segments, query };
}

function defaultPort(scheme: string): number {
  return scheme === 'http' ? 80 : scheme === 'https' ? 443 : -1;
}

function isAsciiWhitespace(c: string | undefined): boolean {
  return c === '\t' || c === '\n' || c === '\f' || c === '\r' || c === ' ';
}

function indexOfFirstNonAsciiWhitespace(input: string): number {
  let i = 0;
  while (i < input.length && isAsciiWhitespace(input[i])) i++;
  return i;
}

function indexOfLastNonAsciiWhitespace(input: string, start: number): number {
  let i = input.length;
  while (i > start && isAsciiWhitespace(input[i - 1])) i--;
  return i;
}

function startsWithIgnoreCase(
  input: string,
  prefix: string,
  pos: number
): boolean {
  return input.slice(pos, pos + prefix.length).toLowerCase() === prefix;
}

function isAsciiLetter(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

function schemeDelimiterOffset(
  input: string,
  pos: number,
  limit: number
): number {
  if (limit - pos < 2) return -1;
  if (!isAsciiLetter(input[pos] as string)) return -1;
  for (let i = pos + 1; i < limit; i++) {
    const c = input[i] as string;
    if (
      isAsciiLetter(c) ||
      (c >= '0' && c <= '9') ||
      c === '+' ||
      c === '-' ||
      c === '.'
    )
      continue;
    return c === ':' ? i : -1;
  }
  return -1;
}

function slashCount(input: string, pos: number, limit: number): number {
  let count = 0;
  for (let i = pos; i < limit; i++) {
    const c = input[i];
    if (c === '\\' || c === '/') count++;
    else break;
  }
  return count;
}

function delimiterOffset(
  input: string,
  delimiters: string,
  pos: number,
  limit: number
): number {
  for (let i = pos; i < limit; i++) {
    if (delimiters.includes(input[i] as string)) return i;
  }
  return limit;
}

/** Finds the first ':' in `input`, skipping characters between square braces. */
function portColonOffset(input: string, pos: number, limit: number): number {
  let i = pos;
  while (i < limit) {
    const c = input[i];
    if (c === '[') {
      while (++i < limit) {
        if (input[i] === ']') break;
      }
    } else if (c === ':') {
      return i;
    }
    i++;
  }
  return limit;
}

function parsePort(input: string, pos: number, limit: number): number {
  // OkHttp canonicalizes with an empty encode set, then Kotlin's String.toInt().
  const portString = canonicalize(input, pos, limit, '', false, false);
  if (!/^[+-]?[0-9]+$/.test(portString)) return -1;
  const port = Number(portString);
  return port >= 1 && port <= 65535 ? port : -1;
}

function resolvePath(
  segments: string[],
  input: string,
  startPos: number,
  limit: number
): void {
  let pos = startPos;
  if (pos === limit) return; // Empty path: keep the default "/".
  const c = input[pos];
  if (c === '/' || c === '\\') {
    segments.length = 0;
    segments.push('');
    pos++;
  } else {
    segments[segments.length - 1] = '';
  }
  let i = pos;
  while (i < limit) {
    const segmentEnd = delimiterOffset(input, '/\\', i, limit);
    const hasTrailingSlash = segmentEnd < limit;
    pushSegment(
      segments,
      canonicalize(input, i, segmentEnd, PATH_SEGMENT_ENCODE_SET, true, false),
      hasTrailingSlash
    );
    i = hasTrailingSlash ? segmentEnd + 1 : segmentEnd;
  }
}

function pushSegment(
  segments: string[],
  segment: string,
  addTrailingSlash: boolean
): void {
  const lower = segment.toLowerCase();
  if (segment === '.' || lower === '%2e') return;
  if (
    segment === '..' ||
    lower === '%2e.' ||
    lower === '.%2e' ||
    lower === '%2e%2e'
  ) {
    // Pop: the path always ends with "/" afterwards.
    const removed = segments.pop() as string;
    if (removed === '' && segments.length > 0)
      segments[segments.length - 1] = '';
    else segments.push('');
    return;
  }
  if (segments[segments.length - 1] === '')
    segments[segments.length - 1] = segment;
  else segments.push(segment);
  if (addTrailingSlash) segments.push('');
}

function toQueryNamesAndValues(query: string): Array<string | null> {
  const result: Array<string | null> = [];
  let pos = 0;
  while (pos <= query.length) {
    let ampersandOffset = query.indexOf('&', pos);
    if (ampersandOffset === -1) ampersandOffset = query.length;
    const equalsOffset = query.indexOf('=', pos);
    if (equalsOffset === -1 || equalsOffset > ampersandOffset) {
      result.push(query.slice(pos, ampersandOffset), null);
    } else {
      result.push(
        query.slice(pos, equalsOffset),
        query.slice(equalsOffset + 1, ampersandOffset)
      );
    }
    pos = ampersandOffset + 1;
  }
  return result;
}

/** UTF-8 bytes of one code point; a lone surrogate becomes '?', as okio's writeUtf8CodePoint does. */
function utf8Bytes(codePoint: number): number[] {
  if (codePoint < 0x80) return [codePoint];
  if (codePoint < 0x800)
    return [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)];
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return [0x3f];
  if (codePoint < 0x10000) {
    return [
      0xe0 | (codePoint >> 12),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f)
    ];
  }
  return [
    0xf0 | (codePoint >> 18),
    0x80 | ((codePoint >> 12) & 0x3f),
    0x80 | ((codePoint >> 6) & 0x3f),
    0x80 | (codePoint & 0x3f)
  ];
}

/** OkHttp `String.canonicalize` with strict = false, unicodeAllowed = false and UTF-8. */
function canonicalize(
  input: string,
  pos: number,
  limit: number,
  encodeSet: string,
  alreadyEncoded: boolean,
  plusIsSpace: boolean
): string {
  let out = '';
  let i = pos;
  while (i < limit) {
    const codePoint = input.codePointAt(i) as number;
    const charCount = codePoint > 0xffff ? 2 : 1;
    if (
      alreadyEncoded &&
      (codePoint === 0x09 ||
        codePoint === 0x0a ||
        codePoint === 0x0c ||
        codePoint === 0x0d)
    ) {
      // Skip this character.
    } else if (codePoint === 0x2b && plusIsSpace) {
      out += alreadyEncoded ? '+' : '%2B';
    } else if (
      codePoint < 0x20 ||
      codePoint === 0x7f ||
      codePoint >= 0x80 ||
      encodeSet.includes(String.fromCharCode(codePoint)) ||
      (codePoint === 0x25 && !alreadyEncoded)
    ) {
      for (const b of utf8Bytes(codePoint)) {
        out += '%' + HEX_DIGITS[b >> 4] + HEX_DIGITS[b & 0xf];
      }
    } else {
      out += String.fromCharCode(codePoint);
    }
    i += charCount;
  }
  return out;
}

function parseHexDigit(c: string | undefined): number {
  if (c === undefined) return -1;
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'a' && c <= 'f') return c.charCodeAt(0) - 87;
  if (c >= 'A' && c <= 'F') return c.charCodeAt(0) - 55;
  return -1;
}

/** OkHttp `String.percentDecode`: bytes, then UTF-8 with U+FFFD for malformed input. */
function percentDecode(
  encoded: string,
  pos: number,
  limit: number,
  plusIsSpace: boolean
): string {
  const bytes: number[] = [];
  let i = pos;
  while (i < limit) {
    const codePoint = encoded.codePointAt(i) as number;
    if (codePoint === 0x25 && i + 2 < limit) {
      const d1 = parseHexDigit(encoded[i + 1]);
      const d2 = parseHexDigit(encoded[i + 2]);
      if (d1 !== -1 && d2 !== -1) {
        bytes.push((d1 << 4) + d2);
        i += 3;
        continue;
      }
    } else if (codePoint === 0x2b && plusIsSpace) {
      bytes.push(0x20);
      i++;
      continue;
    }
    for (const b of utf8Bytes(codePoint)) bytes.push(b);
    i += codePoint > 0xffff ? 2 : 1;
  }
  return decodeUtf8(bytes);
}

const REPLACEMENT = '\ufffd';

function isNotContinuation(b: number | undefined): boolean {
  return b === undefined || (b & 0xc0) !== 0x80;
}

/**
 * UTF-8 to string with the JVM's rules for malformed input (java.lang.String's UTF-8
 * decoding, which okio's readUtf8 uses on the JVM and which the app's unit test proves).
 * WHATWG `TextDecoder` and okio's own decoder count some malformed sequences differently.
 */
function decodeUtf8(src: number[]): string {
  let out = '';
  let sp = 0;
  const sl = src.length;
  while (sp < sl) {
    const b1 = src[sp++] as number;
    if (b1 < 0x80) {
      out += String.fromCharCode(b1);
    } else if ((b1 & 0xe0) === 0xc0 && (b1 & 0x1e) !== 0) {
      // Two bytes, C2..DF.
      if (sp < sl) {
        const b2 = src[sp++] as number;
        if (isNotContinuation(b2)) {
          out += REPLACEMENT;
          sp--;
        } else {
          out += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f));
        }
        continue;
      }
      out += REPLACEMENT;
      break;
    } else if ((b1 & 0xf0) === 0xe0) {
      // Three bytes.
      if (sp + 1 < sl) {
        const b2 = src[sp++] as number;
        const b3 = src[sp++] as number;
        if (isMalformed3(b1, b2) || isNotContinuation(b3)) {
          out += REPLACEMENT;
          sp -= 3;
          sp +=
            (b1 === 0xe0 && (b2 & 0xe0) === 0x80) || isNotContinuation(b2)
              ? 1
              : 2;
        } else {
          const c = ((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
          out +=
            c >= 0xd800 && c <= 0xdfff ? REPLACEMENT : String.fromCharCode(c);
        }
        continue;
      }
      if (sp < sl && isMalformed3(b1, src[sp] as number)) {
        out += REPLACEMENT;
        continue;
      }
      out += REPLACEMENT;
      break;
    } else if ((b1 & 0xf8) === 0xf0) {
      // Four bytes.
      if (sp + 2 < sl) {
        const b2 = src[sp++] as number;
        const b3 = src[sp++] as number;
        const b4 = src[sp++] as number;
        const uc =
          ((b1 & 0x07) << 18) |
          ((b2 & 0x3f) << 12) |
          ((b3 & 0x3f) << 6) |
          (b4 & 0x3f);
        if (
          isNotContinuation(b2) ||
          isNotContinuation(b3) ||
          isNotContinuation(b4) ||
          uc < 0x10000 ||
          uc > 0x10ffff
        ) {
          out += REPLACEMENT;
          sp -= 4;
          sp += malformed4Length(b1, b2, b3);
        } else {
          out += String.fromCodePoint(uc);
        }
        continue;
      }
      if (b1 > 0xf4 || (sp < sl && isMalformed4Second(b1, src[sp] as number))) {
        out += REPLACEMENT;
        continue;
      }
      sp++;
      out += REPLACEMENT;
      if (sp < sl && isNotContinuation(src[sp])) continue;
      break;
    } else {
      out += REPLACEMENT;
    }
  }
  return out;
}

function isMalformed3(b1: number, b2: number): boolean {
  return (b1 === 0xe0 && (b2 & 0xe0) === 0x80) || isNotContinuation(b2);
}

function isMalformed4Second(b1: number, b2: number): boolean {
  return (
    (b1 === 0xf0 && (b2 < 0x90 || b2 > 0xbf)) ||
    (b1 === 0xf4 && (b2 & 0xf0) !== 0x80) ||
    isNotContinuation(b2)
  );
}

function malformed4Length(b1: number, b2: number, b3: number): number {
  if (b1 > 0xf4 || isMalformed4Second(b1, b2)) return 1;
  return isNotContinuation(b3) ? 2 : 3;
}

/** OkHttp `String.toCanonicalHost`: IPv6 text for ':' hosts, IDN ToASCII otherwise; null when invalid. */
function toCanonicalHost(host: string): string | null {
  if (host.includes(':')) {
    const address =
      host.startsWith('[') && host.endsWith(']')
        ? decodeIpv6(host, 1, host.length - 1)
        : decodeIpv6(host, 0, host.length);
    if (address === null) return null;
    if (isMappedIpv4Address(address))
      return Array.from(address.slice(12, 16)).join('.');
    return inet6AddressToAscii(address);
  }
  const result = idnToAscii(host);
  if (result === null || result === '') return null;
  if (containsInvalidHostnameAsciiCodes(result)) return null;
  if (containsInvalidLabelLengths(result)) return null;
  return result;
}

/**
 * OkHttp `idnToAscii`: map, NFC, Punycode-decode each label, check NFC, Punycode-encode.
 *
 * An ASCII host follows OkHttp exactly: its mapping only lower-cases A-Z, and control
 * characters are refused. A host with non-ASCII characters uses Node's UTS #46
 * `domainToASCII` for the mapping. A non-numeric last label is appended for that call
 * so that Node's WHATWG host parser does not rewrite a numeric IPv4 form ("0x7f.1"),
 * which OkHttp keeps as written.
 */
function idnToAscii(host: string): string | null {
  for (let i = 0; i < host.length; i++) {
    const code = host.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return null;
  }
  // sdlc-debt: a non-ASCII host is mapped by Node's UTS #46 code, not OkHttp's IDNA table; they can
  // differ on invalid hosts (WHATWG-forbidden ASCII such as "|" beside non-ASCII, bidi or joiner rules).
  // Upgrade path: port OkHttp's IDNA mapping table if such hosts ever matter for dedupe.
  if (hasNonAscii(host)) {
    const ascii = domainToASCII(host + '.x');
    if (!ascii.endsWith('.x')) return null;
    return ascii.slice(0, -2).toLowerCase();
  }
  const decoded = punycodeDecode(host.toLowerCase());
  if (decoded === null || decoded !== decoded.normalize('NFC')) return null;
  return punycodeEncode(decoded);
}

function hasNonAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 0x80) return true;
  }
  return false;
}

const PUNYCODE_BASE = 36;
const PUNYCODE_TMIN = 1;
const PUNYCODE_TMAX = 26;
const PUNYCODE_SKEW = 38;
const PUNYCODE_DAMP = 700;
const PUNYCODE_INITIAL_BIAS = 72;
const PUNYCODE_INITIAL_N = 0x80;
const INT_MAX = 0x7fffffff;

/** OkHttp `Punycode.decode`: labels starting with "xn--" are decoded; null when malformed. */
function punycodeDecode(host: string): string | null {
  const labels: string[] = [];
  for (const label of host.split('.')) {
    if (label.slice(0, 4).toLowerCase() !== 'xn--') {
      labels.push(label);
      continue;
    }
    const codePoints: number[] = [];
    let pos = 4;
    const lastDelimiter = label.lastIndexOf('-');
    if (lastDelimiter >= pos) {
      while (pos < lastDelimiter) {
        const c = label[pos++] as string;
        if (!/[a-zA-Z0-9-]/.test(c)) return null;
        codePoints.push(c.charCodeAt(0));
      }
      pos++; // Consume '-'.
    }
    let n = PUNYCODE_INITIAL_N;
    let i = 0;
    let bias = PUNYCODE_INITIAL_BIAS;
    while (pos < label.length) {
      const oldi = i;
      let w = 1;
      for (let k = PUNYCODE_BASE; ; k += PUNYCODE_BASE) {
        if (pos === label.length) return null;
        const c = label[pos++] as string;
        let digit: number;
        if (c >= 'a' && c <= 'z') digit = c.charCodeAt(0) - 97;
        else if (c >= 'A' && c <= 'Z') digit = c.charCodeAt(0) - 65;
        else if (c >= '0' && c <= '9') digit = c.charCodeAt(0) - 48 + 26;
        else return null;
        const deltaI = digit * w;
        if (i > INT_MAX - deltaI) return null;
        i += deltaI;
        const t =
          k <= bias
            ? PUNYCODE_TMIN
            : k >= bias + PUNYCODE_TMAX
              ? PUNYCODE_TMAX
              : k - bias;
        if (digit < t) break;
        const scaleW = PUNYCODE_BASE - t;
        if (w > Math.trunc(INT_MAX / scaleW)) return null;
        w *= scaleW;
      }
      bias = punycodeAdapt(i - oldi, codePoints.length + 1, oldi === 0);
      const deltaN = Math.trunc(i / (codePoints.length + 1));
      if (n > INT_MAX - deltaN) return null;
      n += deltaN;
      i %= codePoints.length + 1;
      if (n > 0x10ffff) return null;
      codePoints.splice(i, 0, n);
      i++;
    }
    // okio writes '?' for a surrogate code point.
    labels.push(
      codePoints
        .map((cp) =>
          cp >= 0xd800 && cp <= 0xdfff ? '?' : String.fromCodePoint(cp)
        )
        .join('')
    );
  }
  return labels.join('.');
}

/** OkHttp `Punycode.encode`: labels with non-ASCII characters become "xn--" labels. */
function punycodeEncode(host: string): string | null {
  const labels: string[] = [];
  for (const label of host.split('.')) {
    if (!hasNonAscii(label)) {
      labels.push(label);
      continue;
    }
    const input = Array.from(label, (c) => {
      const cp = c.codePointAt(0) as number;
      return cp >= 0xd800 && cp <= 0xdfff ? 0x3f : cp; // A lone surrogate counts as '?'.
    });
    let out = 'xn--';
    let b = 0;
    for (const cp of input) {
      if (cp < PUNYCODE_INITIAL_N) {
        out += String.fromCharCode(cp);
        b++;
      }
    }
    if (b > 0) out += '-';
    let n = PUNYCODE_INITIAL_N;
    let delta = 0;
    let bias = PUNYCODE_INITIAL_BIAS;
    let h = b;
    while (h < input.length) {
      let m = INT_MAX;
      for (const cp of input) if (cp >= n && cp < m) m = cp;
      const increment = (m - n) * (h + 1);
      if (delta > INT_MAX - increment) return null;
      delta += increment;
      n = m;
      for (const c of input) {
        if (c < n) {
          if (delta === INT_MAX) return null;
          delta++;
        } else if (c === n) {
          let q = delta;
          for (let k = PUNYCODE_BASE; ; k += PUNYCODE_BASE) {
            const t =
              k <= bias
                ? PUNYCODE_TMIN
                : k >= bias + PUNYCODE_TMAX
                  ? PUNYCODE_TMAX
                  : k - bias;
            if (q < t) break;
            out += punycodeDigit(t + ((q - t) % (PUNYCODE_BASE - t)));
            q = Math.trunc((q - t) / (PUNYCODE_BASE - t));
          }
          out += punycodeDigit(q);
          bias = punycodeAdapt(delta, h + 1, h === b);
          delta = 0;
          h++;
        }
      }
      delta++;
      n++;
    }
    labels.push(out);
  }
  return labels.join('.');
}

function punycodeAdapt(
  delta: number,
  numPoints: number,
  first: boolean
): number {
  let d = first ? Math.trunc(delta / PUNYCODE_DAMP) : Math.trunc(delta / 2);
  d += Math.trunc(d / numPoints);
  let k = 0;
  while (d > ((PUNYCODE_BASE - PUNYCODE_TMIN) * PUNYCODE_TMAX) / 2) {
    d = Math.trunc(d / (PUNYCODE_BASE - PUNYCODE_TMIN));
    k += PUNYCODE_BASE;
  }
  return (
    k +
    Math.trunc(((PUNYCODE_BASE - PUNYCODE_TMIN + 1) * d) / (d + PUNYCODE_SKEW))
  );
}

function punycodeDigit(d: number): string {
  return d < 26
    ? String.fromCharCode(97 + d)
    : String.fromCharCode(48 + d - 26);
}

function containsInvalidHostnameAsciiCodes(host: string): boolean {
  for (const c of host) {
    const code = c.charCodeAt(0);
    if (code <= 0x1f || code >= 0x7f) return true;
    if (' #%/:?@[\\]'.includes(c)) return true;
  }
  return false;
}

/** True when the length is not valid for DNS or a label is not 1 to 63 characters. A trailing dot is allowed. */
function containsInvalidLabelLengths(host: string): boolean {
  if (host.length < 1 || host.length > 253) return true;
  let labelStart = 0;
  for (;;) {
    const dot = host.indexOf('.', labelStart);
    const labelLength =
      dot === -1 ? host.length - labelStart : dot - labelStart;
    if (labelLength < 1 || labelLength > 63) return true;
    if (dot === -1 || dot === host.length - 1) break;
    labelStart = dot + 1;
  }
  return false;
}

/** Decodes an IPv6 address like 1111:2222:3333:4444:5555:6666:7777:8888 or ::1. */
function decodeIpv6(
  input: string,
  pos: number,
  limit: number
): Uint8Array | null {
  const address = new Uint8Array(16);
  let b = 0;
  let compress = -1;
  let groupOffset = -1;
  let i = pos;
  while (i < limit) {
    if (b === address.length) return null; // Too many groups.
    if (i + 2 <= limit && input.startsWith('::', i)) {
      if (compress !== -1) return null; // Multiple "::" delimiters.
      i += 2;
      b += 2;
      compress = b;
      if (i === limit) break;
    } else if (b !== 0) {
      if (input.startsWith(':', i)) {
        i++;
      } else if (input.startsWith('.', i)) {
        // Rewind to the beginning of the previous group and parse as IPv4.
        if (!decodeIpv4Suffix(input, groupOffset, limit, address, b - 2))
          return null;
        b += 2;
        break;
      } else {
        return null; // Wrong delimiter.
      }
    }
    let value = 0;
    groupOffset = i;
    while (i < limit) {
      const hexDigit = parseHexDigit(input[i]);
      if (hexDigit === -1) break;
      value = (value << 4) + hexDigit;
      i++;
    }
    const groupLength = i - groupOffset;
    if (groupLength === 0 || groupLength > 4) return null;
    address[b++] = (value >>> 8) & 0xff;
    address[b++] = value & 0xff;
  }
  if (b !== address.length) {
    if (compress === -1) return null;
    address.copyWithin(address.length - (b - compress), compress, b);
    address.fill(0, compress, compress + (address.length - b));
  }
  return address;
}

/** Decodes an IPv4 address suffix of an IPv6 address, like 1111::5555:6666:192.168.0.1. */
function decodeIpv4Suffix(
  input: string,
  pos: number,
  limit: number,
  address: Uint8Array,
  addressOffset: number
): boolean {
  let b = addressOffset;
  let i = pos;
  while (i < limit) {
    if (b === address.length) return false;
    if (b !== addressOffset) {
      if (input[i] !== '.') return false;
      i++;
    }
    let value = 0;
    const groupOffset = i;
    while (i < limit) {
      const c = input[i] as string;
      if (c < '0' || c > '9') break;
      if (value === 0 && groupOffset !== i) return false; // Unnecessary leading '0'.
      value = value * 10 + c.charCodeAt(0) - 48;
      if (value > 255) return false;
      i++;
    }
    if (i - groupOffset === 0) return false;
    address[b++] = value;
  }
  return b === addressOffset + 4;
}

function isMappedIpv4Address(address: Uint8Array): boolean {
  for (let i = 0; i < 10; i++) {
    if (address[i] !== 0) return false;
  }
  return address[10] === 0xff && address[11] === 0xff;
}

/** RFC 5952 text of a 16-byte IPv6 address, as OkHttp's inet6AddressToAscii. */
function inet6AddressToAscii(address: Uint8Array): string {
  let longestRunOffset = -1;
  let longestRunLength = 0;
  for (let i = 0; i < address.length; i += 2) {
    const currentRunOffset = i;
    while (i < 16 && address[i] === 0 && address[i + 1] === 0) i += 2;
    const currentRunLength = i - currentRunOffset;
    if (currentRunLength > longestRunLength && currentRunLength >= 4) {
      longestRunOffset = currentRunOffset;
      longestRunLength = currentRunLength;
    }
  }
  let result = '';
  let i = 0;
  while (i < address.length) {
    if (i === longestRunOffset) {
      result += ':';
      i += longestRunLength;
      if (i === 16) result += ':';
    } else {
      if (i > 0) result += ':';
      result += (
        ((address[i] as number) << 8) |
        (address[i + 1] as number)
      ).toString(16);
      i += 2;
    }
  }
  return result;
}
