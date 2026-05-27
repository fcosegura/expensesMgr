import type {
  AccountInput,
  ExpenseInput,
  ExpenseTemplateInput,
  IncomeInput,
  UserSettings,
} from '../domain/types'
import {
  getCurrentSession,
  handleGoogleCallback,
  handleGoogleLogin,
  handleLogout,
  type AppEnv,
} from './auth'
import {
  addIncome,
  ensureDatabaseReady,
  getAppData,
  updateSettings,
  upsertAccount,
  upsertExpense,
  upsertExpenseTemplate,
} from './repository'

function json(data: unknown, status = 200) {
  return Response.json(data, { status })
}

function getApiPathSegments(url: URL) {
  const rest = url.pathname.replace(/^\/api\/?/, '')
  return rest ? rest.split('/').filter(Boolean) : []
}

async function readBody<T>(request: Request) {
  return (await request.json()) as T
}

export async function handleApiRequest(request: Request, env: AppEnv): Promise<Response> {
  await ensureDatabaseReady(env.DB)

  const url = new URL(request.url)
  const [first, second] = getApiPathSegments(url)

  if (first === 'auth' && second === 'login' && request.method === 'GET') {
    return handleGoogleLogin(request, env)
  }

  if (first === 'auth' && second === 'callback' && request.method === 'GET') {
    return handleGoogleCallback(request, env)
  }

  if (first === 'auth' && second === 'logout' && request.method === 'POST') {
    return handleLogout(request, env)
  }

  if (first === 'session' && request.method === 'GET') {
    const user = await getCurrentSession(request, env)
    return json({
      mode: 'prod',
      isAuthenticated: Boolean(user),
      user,
    })
  }

  const user = await getCurrentSession(request, env)

  if (!user) {
    return new Response('Sesion no valida.', { status: 401 })
  }

  if ((first === undefined || first === 'data') && request.method === 'GET') {
    return json(await getAppData(env.DB, user.id))
  }

  if (first === 'accounts' && request.method === 'POST') {
    await upsertAccount(env.DB, user.id, await readBody<AccountInput>(request))
    return new Response(null, { status: 204 })
  }

  if (first === 'incomes' && request.method === 'POST') {
    await addIncome(env.DB, user.id, await readBody<IncomeInput>(request))
    return new Response(null, { status: 204 })
  }

  if (first === 'expense-templates' && request.method === 'POST') {
    await upsertExpenseTemplate(env.DB, user.id, await readBody<ExpenseTemplateInput>(request))
    return new Response(null, { status: 204 })
  }

  if (first === 'expenses' && request.method === 'POST') {
    await upsertExpense(env.DB, user.id, await readBody<ExpenseInput>(request))
    return new Response(null, { status: 204 })
  }

  if (first === 'settings' && request.method === 'PUT') {
    await updateSettings(env.DB, user.id, await readBody<UserSettings>(request))
    return new Response(null, { status: 204 })
  }

  return new Response('Ruta API no encontrada.', { status: 404 })
}
