import { handleApiRequest } from './server/api'
import type { AppEnv } from './server/auth'

export interface WorkerEnv extends AppEnv {
  STATIC: Fetcher
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await handleApiRequest(request, env)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error interno del servidor.'
        return Response.json({ error: message }, { status: 500 })
      }
    }

    return env.STATIC.fetch(request)
  },
}
