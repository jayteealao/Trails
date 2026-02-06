import type { ReadabilityResult } from './types.js';

/**
 * Convert Readability result to simple markdown.
 */
export function toMarkdown(result: ReadabilityResult): string {
  const lines: string[] = [];

  if (result.title) {
    lines.push(`# ${result.title}`);
    lines.push('');
  }

  if (result.byline) {
    lines.push(`*${result.byline}*`);
    lines.push('');
  }

  if (result.publishedTime) {
    lines.push(`Published: ${result.publishedTime}`);
    lines.push('');
  }

  if (result.textContent) {
    lines.push(result.textContent.trim());
  }

  return lines.join('\n');
}
