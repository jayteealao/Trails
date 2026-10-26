/** The slice of a parsed DOM document that lead-image extraction reads. */
export interface MetaQueryable {
  querySelectorAll(selectors: string): ArrayLike<{ getAttribute(name: string): string | null }>;
}

const MAX_LEAD_IMAGE_LENGTH = 2048;

function firstContent(document: MetaQueryable, key: string): string | null {
  const tags = document.querySelectorAll(`meta[property="${key}"], meta[name="${key}"]`);
  for (let i = 0; i < tags.length; i++) {
    const content = tags[i]?.getAttribute('content')?.trim();
    if (content) return content;
  }
  return null;
}

/**
 * The page's lead image: the first non-blank og:image (else og:image:url),
 * resolved against the page URL. Returns null when the tag is missing, the
 * value does not resolve, is not http(s), or is longer than 2048 characters.
 *
 * Call it before Readability parses the document: parse() rewrites the DOM.
 */
export function extractLeadImage(document: MetaQueryable, pageUrl?: string): string | null {
  const raw = firstContent(document, 'og:image') ?? firstContent(document, 'og:image:url');
  if (!raw) return null;
  try {
    const resolved = new URL(raw, pageUrl || undefined);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.href.length <= MAX_LEAD_IMAGE_LENGTH ? resolved.href : null;
  } catch {
    return null;
  }
}
