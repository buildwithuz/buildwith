import { API_ORIGIN } from '../lib/api.server'

/** Liveness for the deploy script: the web process is up and can reach the API. */
export async function loader() {
  const res = await fetch(`${API_ORIGIN}/v1/health`).catch(() => null)
  return new Response(res?.ok ? 'ok' : 'api unreachable', { status: res?.ok ? 200 : 503 })
}
