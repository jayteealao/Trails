// The typed writer of the shared article `articles/{id}` and the user article
// `users/{uid}/articles/{id}`: every server write of these documents goes
// through one of its write functions, so each field name is spelled once.
export * from './fields.js';
export * from './shared-article.js';
export * from './user-article.js';
