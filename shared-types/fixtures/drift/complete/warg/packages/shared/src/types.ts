// Fixture: the artifact kinds the pipeline produces, as the drift check reads them.
export type ArtifactKind =
  | 'rendered.html'
  | 'rendered.md'
  | 'screenshot.png'
  | 'page.pdf'
  | 'singlefile.html'
  | 'readability.json'
  | 'readability.md'
  | 'ai-markdown.md'
  | 'monolith.html'
  | 'manifest.json';
