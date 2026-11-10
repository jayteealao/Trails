import { describe, expect, it } from 'vitest';
import { convertArticleToMarkdown, resolveArticleUrls } from './ai-markdown.js';

const ARTICLE_URL = 'https://example.com/blog/post';

type ToMarkdown = Pick<Ai, 'toMarkdown'>;

/** A stub binding that records each call and answers one fixed response. */
function stubAi(response: ConversionResponse): {
  ai: ToMarkdown;
  calls: Array<{ document: MarkdownDocument; options?: ConversionRequestOptions }>;
} {
  const calls: Array<{ document: MarkdownDocument; options?: ConversionRequestOptions }> = [];
  const toMarkdown = async (
    document: MarkdownDocument,
    options?: ConversionRequestOptions
  ): Promise<ConversionResponse> => {
    calls.push({ document, options });
    return response;
  };
  // sdlc-debt: the binding's overloaded toMarkdown cannot be implemented by one
  // function signature; the stub covers the single-document overload the module calls.
  // Upgrade path: stub the array overload too if the module ever converts several documents.
  return { ai: { toMarkdown } as unknown as ToMarkdown, calls };
}

const markdownAnswer = (data: string): ConversionResponse => ({
  id: '1',
  name: 'article.html',
  mimeType: 'text/html',
  format: 'markdown',
  tokens: 1,
  data,
});

describe('resolveArticleUrls', () => {
  it('resolves a relative link and a relative image against the article URL', () => {
    const html = '<p><a href="../next">Next</a> <img src="img/a.png" alt="A"></p>';
    expect(resolveArticleUrls(html, ARTICLE_URL)).toBe(
      '<p><a href="https://example.com/next">Next</a> <img src="https://example.com/blog/img/a.png" alt="A"></p>'
    );
  });

  it('resolves root-relative and protocol-relative URLs', () => {
    const html = '<a href="/about">About</a><img src="//cdn.example.net/b.jpg">';
    expect(resolveArticleUrls(html, ARTICLE_URL)).toBe(
      '<a href="https://example.com/about">About</a><img src="https://cdn.example.net/b.jpg">'
    );
  });

  it('keeps absolute URLs, fragments, data and mailto values unchanged', () => {
    const html =
      '<a href="https://other.example/x">x</a><a href="#notes">n</a>' +
      '<img src="data:image/png;base64,AAAA"><a href="mailto:me@example.com">m</a>';
    expect(resolveArticleUrls(html, ARTICLE_URL)).toBe(html);
  });

  it('keeps an escaped ampersand in a query string', () => {
    const html = '<a href="search?q=a&amp;page=2">s</a>';
    expect(resolveArticleUrls(html, ARTICLE_URL)).toBe(
      '<a href="https://example.com/blog/search?q=a&amp;page=2">s</a>'
    );
  });

  it('leaves attributes that only end in src or href alone', () => {
    const html = '<img data-src="lazy.png" src="real.png">';
    expect(resolveArticleUrls(html, ARTICLE_URL)).toBe(
      '<img data-src="lazy.png" src="https://example.com/blog/real.png">'
    );
  });
});

describe('convertArticleToMarkdown', () => {
  it('sends the resolved HTML as a text/html blob with the article URL as hostname', async () => {
    const { ai, calls } = stubAi(markdownAnswer('# Title\n\nBody'));
    const markdown = await convertArticleToMarkdown(
      ai,
      '<h1>Title</h1><a href="../next">Next</a>',
      ARTICLE_URL
    );

    expect(markdown).toBe('# Title\n\nBody');
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error('toMarkdown was not called');
    const { document, options } = call;
    expect(document.blob.type).toBe('text/html');
    expect(await document.blob.text()).toBe(
      '<h1>Title</h1><a href="https://example.com/next">Next</a>'
    );
    expect(options?.conversionOptions?.html?.hostname).toBe(ARTICLE_URL);
  });

  it('throws when the conversion answers an error', async () => {
    const { ai } = stubAi({
      id: '1',
      name: 'article.html',
      mimeType: 'text/html',
      format: 'error',
      error: 'unsupported',
    });
    await expect(convertArticleToMarkdown(ai, '<p>x</p>', ARTICLE_URL)).rejects.toThrow(
      'AI Markdown conversion failed: unsupported'
    );
  });

  it('throws when the conversion answers no text', async () => {
    const { ai } = stubAi(markdownAnswer('  \n'));
    await expect(convertArticleToMarkdown(ai, '<p>x</p>', ARTICLE_URL)).rejects.toThrow(
      'AI Markdown conversion returned no text'
    );
  });
});
