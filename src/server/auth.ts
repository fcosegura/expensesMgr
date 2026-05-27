import { createSession, deleteSession, getSessionUser, upsertGoogleUser } from './repository'

export interface AppEnv {
  DB: D1Database
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  APP_BASE_URL?: string
}

const SESSION_COOKIE = 'em_session'
const STATE_COOKIE = 'em_oauth_state'

function getCookie(request: Request, name: string) {
  const raw = request.headers.get('Cookie')
  if (!raw) {
    return null
  }

  for (const segment of raw.split(';')) {
    const [key, ...valueParts] = segment.trim().split('=')
    if (key === name) {
      return decodeURIComponent(valueParts.join('='))
    }
  }

  return null
}

function serializeCookie(name: string, value: string, options: Record<string, string | number | boolean>) {
  const attributes = Object.entries(options)
    .filter(([, optionValue]) => optionValue !== false && optionValue !== undefined && optionValue !== null)
    .map(([key, optionValue]) => {
      if (optionValue === true) {
        return key
      }

      return `${key}=${optionValue}`
    })
    .join('; ')

  return `${name}=${encodeURIComponent(value)}; ${attributes}`
}

function getBaseUrl(request: Request, env: AppEnv) {
  return env.APP_BASE_URL || new URL(request.url).origin
}

function requireGoogleConfig(env: AppEnv) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Response('Faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en el entorno de Cloudflare.', {
      status: 500,
    })
  }
}

export async function getCurrentSession(request: Request, env: AppEnv) {
  const sessionId = getCookie(request, SESSION_COOKIE)
  if (!sessionId) {
    return null
  }

  const user = await getSessionUser(env.DB, sessionId)

  if (!user) {
    return null
  }

  return {
    id: String(user.id),
    email: String(user.email),
    name: String(user.name),
    avatarUrl: user.avatar_url ? String(user.avatar_url) : undefined,
  }
}

export async function handleGoogleLogin(request: Request, env: AppEnv) {
  requireGoogleConfig(env)

  const state = crypto.randomUUID()
  const redirectUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  redirectUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID!)
  redirectUrl.searchParams.set('redirect_uri', `${getBaseUrl(request, env)}/api/auth/callback`)
  redirectUrl.searchParams.set('response_type', 'code')
  redirectUrl.searchParams.set('scope', 'openid email profile')
  redirectUrl.searchParams.set('prompt', 'select_account')
  redirectUrl.searchParams.set('state', state)

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl.toString(),
      'Set-Cookie': serializeCookie(STATE_COOKIE, state, {
        Path: '/',
        HttpOnly: true,
        Secure: true,
        SameSite: 'Lax',
        'Max-Age': 600,
      }),
    },
  })
}

export async function handleGoogleCallback(request: Request, env: AppEnv) {
  requireGoogleConfig(env)

  const requestUrl = new URL(request.url)
  const state = requestUrl.searchParams.get('state')
  const code = requestUrl.searchParams.get('code')
  const storedState = getCookie(request, STATE_COOKIE)

  if (!state || !code || !storedState || state !== storedState) {
    return new Response('OAuth state invalido.', { status: 400 })
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${getBaseUrl(request, env)}/api/auth/callback`,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenResponse.ok) {
    return new Response('No se pudo completar el intercambio OAuth con Google.', { status: 502 })
  }

  const tokenData = (await tokenResponse.json()) as { access_token?: string }

  if (!tokenData.access_token) {
    return new Response('Google no devolvio un access token valido.', { status: 502 })
  }

  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  })

  if (!profileResponse.ok) {
    return new Response('No se pudo recuperar el perfil de Google.', { status: 502 })
  }

  const profile = (await profileResponse.json()) as {
    sub: string
    email: string
    name: string
    picture?: string
  }

  const user = await upsertGoogleUser(env.DB, profile)
  const sessionId = await createSession(env.DB, user.id)
  const headers = new Headers({ Location: '/' })
  headers.append(
    'Set-Cookie',
    serializeCookie(STATE_COOKIE, '', {
      Path: '/',
      HttpOnly: true,
      Secure: true,
      SameSite: 'Lax',
      'Max-Age': 0,
    }),
  )
  headers.append(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, sessionId, {
      Path: '/',
      HttpOnly: true,
      Secure: true,
      SameSite: 'Lax',
      'Max-Age': 60 * 60 * 24 * 30,
    }),
  )

  return new Response(null, {
    status: 302,
    headers,
  })
}

export async function handleLogout(request: Request, env: AppEnv) {
  const sessionId = getCookie(request, SESSION_COOKIE)

  if (sessionId) {
    await deleteSession(env.DB, sessionId)
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Set-Cookie': serializeCookie(SESSION_COOKIE, '', {
        Path: '/',
        HttpOnly: true,
        Secure: true,
        SameSite: 'Lax',
        'Max-Age': 0,
      }),
    },
  })
}
