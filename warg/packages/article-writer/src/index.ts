// The typed writer of the shared article `articles/{id}` and the user article
// `users/{uid}/articles/{id}`: every server write of these documents goes
// through one of its write functions, so each field name is spelled once. It
// also holds the one reader of a user article's shared-article link
// (`resolve.ts`) and the one projection of a user article onto the shared
// article's pocket map (`pocket.ts`).
export * from './bulk.js';
export * from './fields.js';
export * from './pocket.js';
export * from './resolve.js';
export * from './shared-article.js';
export * from './user-article.js';
