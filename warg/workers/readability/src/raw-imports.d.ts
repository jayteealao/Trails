// Vitest serves a `?raw` import as the file's exact UTF-8 text.
declare module '*?raw' {
  const text: string;
  export default text;
}
