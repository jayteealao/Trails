// The path matcher of the Pages router, for the route syntax the dashboard
// uses: static text and `:name` segments (from `[name]` file names).
//
// It builds the same regular expression as path-to-regexp 6.3.0's
// `match(path, { end })` with its defaults (case-insensitive, an optional
// trailing delimiter, no decoding), which is what Pages runs: wrangler bundles
// its router template with that version. The workspace pins path-to-regexp
// 8 for other packages, so the 6.3.0 behaviour is written out here, and
// src/__tests__/router.test.ts checks it against wrangler's own copy.
// A route that uses any other syntax (catch-alls, modifiers, groups) throws,
// so a new kind of route cannot be matched differently by accident.

export type PathParams = Record<string, string>;

export interface PathMatch {
  path: string;
  params: PathParams;
}

export type PathMatcher = (pathname: string) => PathMatch | false;

// path-to-regexp's escapeString.
function escapeString(text: string): string {
  return text.replace(/([.+*?=^!:${}()[\]|/\\])/g, '\\$1');
}

const PARAM = /\/:([A-Za-z0-9_]+)/g;
const STATIC_TEXT = /^[^:*?+()[\]{}\\]*$/;
// The default delimiters `/#?`, as a character class.
const DELIMITER = '[\\/#\\?]';
const SEGMENT_PATTERN = '[^\\/#\\?]+?';

export function compileRoute(routePath: string, end: boolean): PathMatcher {
  if (!routePath.startsWith('/')) throw new Error(`Route ${routePath} does not start with /`);
  const names: string[] = [];
  let source = '^';
  let last = 0;
  let endsWithParam = false;
  for (const param of routePath.matchAll(PARAM)) {
    const text = routePath.slice(last, param.index);
    if (!STATIC_TEXT.test(text)) throw new Error(`Route ${routePath} uses syntax the dashboard router does not support`);
    source += escapeString(text) + `(?:\\/(${SEGMENT_PATTERN}))`;
    names.push(param[1] ?? '');
    last = param.index + param[0].length;
    endsWithParam = last === routePath.length;
  }
  const rest = routePath.slice(last);
  if (!STATIC_TEXT.test(rest)) throw new Error(`Route ${routePath} uses syntax the dashboard router does not support`);
  source += escapeString(rest);

  if (end) {
    source += `${DELIMITER}?$`;
  } else {
    source += `(?:${DELIMITER}(?=$))?`;
    // A route that ends in a delimiter (only `/`) needs no boundary after it.
    const isEndDelimited = !endsWithParam && /[/#?]$/.test(routePath);
    if (!isEndDelimited) source += `(?=${DELIMITER}|$)`;
  }
  const regex = new RegExp(source, 'i');

  return (pathname) => {
    const m = regex.exec(pathname);
    if (!m) return false;
    const params: PathParams = {};
    names.forEach((name, i) => {
      const value = m[i + 1];
      if (value !== undefined) params[name] = value;
    });
    return { path: m[0], params };
  };
}
