import { handleApiRequest } from '../../src/server/api'
import type { AppEnv } from '../../src/server/auth'

export const onRequest: PagesFunction<AppEnv> = async (context) => {
  return handleApiRequest(context.request, context.env)
}
