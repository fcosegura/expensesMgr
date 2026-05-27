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

/** Public origin used for Google OAuth redirect_uri (must match Google Console exactly). */
export function getOAuthRedirectUri(request: Request, env: AppEnv) {
  return `${getBaseUrl(request, env)}/api/auth/callback`
}

function getBaseUrl(request: Request, env: AppEnv) {
  const origin = new URL(request.url).origin
  const configured = env.APP_BASE_URL?.trim().replace(/\/$/, '')

  if (!configured) {
    return origin
  }

  try {
    const configHost = new URL(configured).host
    const requestHost = new URL(request.url).host
    if (configHost === requestHost) {
      return configured
    }
  } catch {
    // Ignore invalid APP_BASE_URL and fall back to the request origin.
  }

  return origin
}

function requireGoogleConfig(env: AppEnv) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en el entorno de Cloudflare.')
  }
}

function redirectAuthErrorFromRequest(request: Request, env: AppEnv, message: string) {
  const target = new URL('/', getBaseUrl(request, env))
  target.searchParams.set('auth_error', message)
  return Response.redirect(target.toString(), 302)
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
  const redirectUri = getOAuthRedirectUri(request, env)
  const redirectUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  redirectUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID!)
  redirectUrl.searchParams.set('redirect_uri', redirectUri)
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
  const googleError = requestUrl.searchParams.get('error')
  if (googleError) {
    const description = requestUrl.searchParams.get('error_description') ?? googleError
    return redirectAuthErrorFromRequest(
      request,
      env,
      `Google rechazo el inicio de sesion: ${description}`,
    )
  }

  const state = requestUrl.searchParams.get('state')
  const code = requestUrl.searchParams.get('code')
  const storedState = getCookie(request, STATE_COOKIE)

  if (!state || !code || !storedState || state !== storedState) {
    return redirectAuthErrorFromRequest(
      request,
      env,
      'Sesion OAuth invalida. Vuelve a iniciar sesion desde la app (no abras /api/auth/callback directamente).',
    )
  }

  const redirectUri = getOAuthRedirectUri(request, env)
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenResponse.ok) {
    const details = await tokenResponse.text()
    return redirectAuthErrorFromRequest(
      request,
      env,
      `No se pudo validar con Google. Revisa que el redirect URI en Google Console sea exactamente: ${redirectUri}. Detalle: ${details.slice(0, 200)}`,
    )
  }

  const tokenData = (await tokenResponse.json()) as { access_token?: string }

  if (!tokenData.access_token) {
    return redirectAuthErrorFromRequest(request, env, 'Google no devolvio un access token valido.')
  }

  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  })

  if (!profileResponse.ok) {
    return redirectAuthErrorFromRequest(request, env, 'No se pudo recuperar el perfil de Google.')
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
