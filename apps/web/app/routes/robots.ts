export function loader() {
  const body = [
    'User-agent: *',
    'Disallow: /settings',
    'Disallow: /notifications',
    'Disallow: /bookmarks',
    'Disallow: /write',
    'Disallow: /mod',
    'Disallow: /actions/',
    'Disallow: /v1/',
    '',
  ].join('\n')
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
