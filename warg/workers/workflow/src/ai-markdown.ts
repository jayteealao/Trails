// The AI Markdown artifact: Workers AI converts the cleaned Readability HTML
// to structured Markdown (headings, lists, links, images).

/** A scheme such as `https:`, `data:`, `mailto:` marks a value that is already absolute. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** One `href="…"` or `src="…"` attribute. linkedom serializes every attribute in double quotes. */
const LINK_ATTRIBUTE = /(\s)(href|src)="([^"]*)"/gi;

function resolveReference(value: string, articleUrl: string): string {
  if (value === '' || value.startsWith('#') || HAS_SCHEME.test(value)) return value;
  try {
    return new URL(value, articleUrl).href;
  } catch {
    // A reference that does not parse stays as the page wrote it.
    return value;
  }
}

/**
 * Rewrites each relative `href` and `src` in the HTML to an absolute URL
 * resolved against the article URL. Fragments, absolute URLs and other
 * schemes (`data:`, `mailto:`, `tel:`, `javascript:`) stay unchanged.
 */
export function resolveArticleUrls(html: string, articleUrl: string): string {
  return html.replace(LINK_ATTRIBUTE, (match, space: string, name: string, raw: string) => {
    const value = raw.replaceAll('&amp;', '&');
    const resolved = resolveReference(value, articleUrl);
    if (resolved === value) return match;
    return `${space}${name}="${resolved.replaceAll('&', '&amp;')}"`;
  });
}

/**
 * Converts the cleaned article HTML to Markdown with Workers AI. Relative
 * links and images are resolved against the article URL first. Throws when
 * the conversion answers an error or no text.
 */
export async function convertArticleToMarkdown(
  ai: Pick<Ai, 'toMarkdown'>,
  html: string,
  articleUrl: string
): Promise<string> {
  const result = await ai.toMarkdown(
    {
      name: 'article.html',
      blob: new Blob([resolveArticleUrls(html, articleUrl)], { type: 'text/html' }),
    },
    { conversionOptions: { html: { hostname: articleUrl } } }
  );
  if (result.format === 'error') {
    throw new Error(`AI Markdown conversion failed: ${result.error}`);
  }
  if (!result.data.trim()) {
    throw new Error('AI Markdown conversion returned no text');
  }
  return result.data;
}
