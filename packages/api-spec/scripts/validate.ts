// Parses openapi.yaml and checks the house rules that OpenAPI itself cannot express,
// so a contract mistake fails in CI rather than in a generated client.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse } from 'yaml'

const here = dirname(fileURLToPath(import.meta.url))
const specPath = join(here, '..', 'openapi.yaml')
// biome-ignore lint/suspicious/noExplicitAny: the spec is validated field by field below.
const spec = parse(readFileSync(specPath, 'utf8')) as any

const problems: string[] = []
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

const operations: { path: string; method: string; op: Record<string, unknown> }[] = []
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    // biome-ignore lint/suspicious/noExplicitAny: see above.
    const op = (item as any)[method]
    if (op) operations.push({ path, method, op })
  }
}

const ids = new Set<string>()
for (const { path, method, op } of operations) {
  const where = `${method.toUpperCase()} ${path}`
  const id = op.operationId as string | undefined

  if (!id) problems.push(`${where}: missing operationId`)
  else if (ids.has(id)) problems.push(`${where}: duplicate operationId "${id}"`)
  else ids.add(id)
  if (id && !/^[a-z][A-Za-z0-9]*$/.test(id)) problems.push(`${where}: operationId "${id}" is not camelCase`)

  if (!op.summary) problems.push(`${where}: missing summary`)
  if (!op.tags?.length) problems.push(`${where}: missing tag`)

  // Every list endpoint pages with a cursor, never an offset.
  const params = (op.parameters ?? []) as { $ref?: string; name?: string }[]
  const names = params.map((p) => p.$ref?.split('/').pop() ?? p.name)
  if (names.includes('Cursor') && !names.includes('Limit')) {
    problems.push(`${where}: has a cursor but no limit`)
  }

  // Mutations must document what happens when the caller is not signed in,
  // unless they are the sign-in endpoints themselves.
  const isMutation = method !== 'get'
  const isPublic = Array.isArray(op.security) && op.security.length === 0
  if (isMutation && !isPublic && !op.responses?.['401']) {
    problems.push(`${where}: mutation without a 401 response`)
  }
}

// Every $ref must resolve.
const refs: string[] = []
const walk = (node: unknown): void => {
  if (Array.isArray(node)) return void node.forEach(walk)
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') refs.push(v)
      else walk(v)
    }
  }
}
walk(spec)
for (const ref of new Set(refs)) {
  if (!ref.startsWith('#/')) {
    problems.push(`external $ref not allowed: ${ref}`)
    continue
  }
  let node = spec
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part]
    if (node === undefined) break
  }
  if (node === undefined) problems.push(`unresolved $ref: ${ref}`)
}

// Error codes are a closed enum, so the web app can map each to an i18n key.
const codes = spec.components.schemas.ErrorCode?.enum
if (!Array.isArray(codes) || codes.length === 0) problems.push('ErrorCode enum is missing')

if (problems.length > 0) {
  console.error(`openapi.yaml: ${problems.length} problem(s)`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

console.log(
  `openapi.yaml ok: ${Object.keys(spec.paths).length} paths, ${operations.length} operations, ` +
    `${Object.keys(spec.components.schemas).length} schemas`,
)
