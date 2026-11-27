import { index, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  // Lists
  index('routes/top.tsx', { id: 'top' }),
  route('new', 'routes/top.tsx', { id: 'new' }),
  route('best', 'routes/top.tsx', { id: 'best' }),
  route('savol', 'routes/top.tsx', { id: 'savol' }),
  route('korsat', 'routes/top.tsx', { id: 'korsat' }),
  route('notes', 'routes/notes.tsx'),
  route('following', 'routes/following.tsx'),
  route('articles', 'routes/articles.tsx'),
  route('ishlar', 'routes/ishlar.tsx'),
  route('t/:tag', 'routes/tag.tsx'),
  route('search', 'routes/search.tsx'),
  route('bookmarks', 'routes/bookmarks.tsx'),

  // Posts
  route('l/:id/:slug?', 'routes/link.tsx'),
  route('submit', 'routes/submit.tsx'),
  route('n/:id', 'routes/short.tsx', { id: 'short-note' }),
  route('a/:id', 'routes/short.tsx', { id: 'short-article' }),
  route('c/:id', 'routes/short.tsx', { id: 'short-comment' }),

  // Articles
  route('write', 'routes/write-list.tsx'),
  route('write/:id', 'routes/write.tsx'),

  // People and pages share the first segment: "/@aziz" is a profile, "/about"
  // is a page. React Router has no partial segments, so the loaders check the "@".
  route(':handle', 'routes/handle.tsx'),
  route(':handle/n/:id', 'routes/note.tsx'),
  route(':handle/:slug', 'routes/article.tsx'),

  // Account
  route('login', 'routes/login.tsx'),
  route('logout', 'routes/logout.tsx'),
  route('welcome', 'routes/welcome.tsx'),
  route('settings', 'routes/settings.tsx'),
  route('notifications', 'routes/notifications.tsx'),

  // Community
  route('mod', 'routes/mod.tsx'),
  route('modlog', 'routes/modlog.tsx'),

  // Mutations (resource routes)
  route('actions/vote', 'routes/actions/vote.ts'),
  route('actions/note', 'routes/actions/note.ts'),
  route('actions/note-new', 'routes/actions/note-new.ts'),
  route('actions/comment', 'routes/actions/comment.ts'),
  route('actions/relation', 'routes/actions/relation.ts'),
  route('actions/prefs', 'routes/actions/prefs.ts'),
  route('actions/report', 'routes/actions/report.ts'),
  route('actions/mod', 'routes/actions/mod.ts'),
  route('actions/delete', 'routes/actions/delete.ts'),

  // Feeds and health
  route('healthz', 'routes/healthz.ts'),
  route('robots.txt', 'routes/robots.ts'),

  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig
