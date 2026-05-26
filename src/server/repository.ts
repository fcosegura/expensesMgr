import type {
  AccountInput,
  AppData,
  ExpenseInput,
  ExpenseTemplateInput,
  IncomeInput,
  UserProfile,
  UserSettings,
} from '../domain/types'

const DEFAULT_SETTINGS: UserSettings = {
  cutoffDay: 25,
  currency: 'EUR',
  timezone: 'Europe/Madrid',
}

interface GoogleUserProfile {
  sub: string
  email: string
  name: string
  picture?: string
}

function nowIso() {
  return new Date().toISOString()
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function normalizeDate(value?: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value! : today()
}

function asBoolean(value: unknown) {
  return Number(value) === 1
}

function clampDay(value: number) {
  return Math.min(31, Math.max(1, Math.round(value)))
}

function asNumber(value: unknown) {
  return Number(value ?? 0)
}

async function listResults<T>(statement: D1PreparedStatement) {
  const result = await statement.all<T>()
  return result.results ?? []
}

export async function ensureSettings(db: D1Database, userId: string) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO user_settings (user_id, cutoff_day, currency, timezone, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(userId, DEFAULT_SETTINGS.cutoffDay, DEFAULT_SETTINGS.currency, DEFAULT_SETTINGS.timezone, nowIso())
    .run()
}

export async function getAppData(db: D1Database, userId: string): Promise<AppData> {
  await ensureSettings(db, userId)

  const [accounts, incomes, expenseTemplates, expenses, settings] = await Promise.all([
    listResults<Record<string, unknown>>(
      db
        .prepare(
          `SELECT id, name, opening_balance, color, is_active
           FROM accounts
           WHERE user_id = ?
           ORDER BY is_active DESC, name ASC`,
        )
        .bind(userId),
    ),
    listResults<Record<string, unknown>>(
      db
        .prepare(
          `SELECT id, account_id, amount, movement_date, note, created_at
           FROM incomes
           WHERE user_id = ?
           ORDER BY movement_date DESC, created_at DESC`,
        )
        .bind(userId),
    ),
    listResults<Record<string, unknown>>(
      db
        .prepare(
          `SELECT id, name, default_amount, category, due_day, is_active
           FROM expense_templates
           WHERE user_id = ?
           ORDER BY name ASC`,
        )
        .bind(userId),
    ),
    listResults<Record<string, unknown>>(
      db
        .prepare(
          `SELECT id, type, template_id, account_id, is_projected, amount, movement_date, note, category, created_at
           FROM expenses
           WHERE user_id = ?
           ORDER BY movement_date DESC, created_at DESC`,
        )
        .bind(userId),
    ),
    db
      .prepare(
        `SELECT cutoff_day, currency, timezone
         FROM user_settings
         WHERE user_id = ?`,
      )
      .bind(userId)
      .first<Record<string, unknown>>(),
  ])

  return {
    accounts: accounts.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      openingBalance: asNumber(row.opening_balance),
      color: String(row.color),
      isActive: asBoolean(row.is_active),
    })),
    incomes: incomes.map((row) => ({
      id: String(row.id),
      accountId: String(row.account_id),
      amount: asNumber(row.amount),
      movementDate: String(row.movement_date),
      note: String(row.note ?? ''),
      createdAt: String(row.created_at),
    })),
    expenseTemplates: expenseTemplates.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      defaultAmount: asNumber(row.default_amount),
      category: String(row.category),
      dueDay: asNumber(row.due_day),
      isActive: asBoolean(row.is_active),
    })),
    expenses: expenses.map((row) => ({
      id: String(row.id),
      type: row.type === 'fixed' ? 'fixed' : 'variable',
      templateId: row.template_id ? String(row.template_id) : undefined,
      accountId: row.account_id ? String(row.account_id) : undefined,
      isProjected: asBoolean(row.is_projected),
      amount: asNumber(row.amount),
      movementDate: String(row.movement_date),
      note: String(row.note ?? ''),
      category: String(row.category),
      createdAt: String(row.created_at),
    })),
    settings: {
      cutoffDay: asNumber(settings?.cutoff_day ?? DEFAULT_SETTINGS.cutoffDay),
      currency: String(settings?.currency ?? DEFAULT_SETTINGS.currency),
      timezone: String(settings?.timezone ?? DEFAULT_SETTINGS.timezone),
    },
  }
}

export async function upsertAccount(db: D1Database, userId: string, input: AccountInput) {
  const accountId = input.id ?? crypto.randomUUID()
  const timestamp = nowIso()

  await db
    .prepare(
      `INSERT INTO accounts (id, user_id, name, opening_balance, color, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         opening_balance = excluded.opening_balance,
         color = excluded.color,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at
       WHERE user_id = excluded.user_id`,
    )
    .bind(
      accountId,
      userId,
      input.name.trim(),
      asNumber(input.openingBalance),
      input.color,
      input.isActive ? 1 : 0,
      timestamp,
      timestamp,
    )
    .run()
}

export async function addIncome(db: D1Database, userId: string, input: IncomeInput) {
  await db
    .prepare(
      `INSERT INTO incomes (id, user_id, account_id, amount, movement_date, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      input.accountId,
      asNumber(input.amount),
      normalizeDate(input.movementDate),
      input.note.trim(),
      nowIso(),
    )
    .run()
}

export async function upsertExpenseTemplate(
  db: D1Database,
  userId: string,
  input: ExpenseTemplateInput,
) {
  const templateId = input.id ?? crypto.randomUUID()
  const timestamp = nowIso()

  await db
    .prepare(
      `INSERT INTO expense_templates (id, user_id, name, default_amount, category, due_day, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         default_amount = excluded.default_amount,
         category = excluded.category,
         due_day = excluded.due_day,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at
       WHERE user_id = excluded.user_id`,
    )
    .bind(
      templateId,
      userId,
      input.name.trim(),
      asNumber(input.defaultAmount),
      input.category.trim(),
      clampDay(input.dueDay),
      input.isActive ? 1 : 0,
      timestamp,
      timestamp,
    )
    .run()
}

export async function upsertExpense(db: D1Database, userId: string, input: ExpenseInput) {
  const expenseId = input.id ?? crypto.randomUUID()
  const timestamp = nowIso()

  await db
    .prepare(
      `INSERT INTO expenses (id, user_id, template_id, account_id, type, category, is_projected, amount, movement_date, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         template_id = excluded.template_id,
         account_id = excluded.account_id,
         type = excluded.type,
         category = excluded.category,
         is_projected = excluded.is_projected,
         amount = excluded.amount,
         movement_date = excluded.movement_date,
         note = excluded.note,
         updated_at = excluded.updated_at
       WHERE user_id = excluded.user_id`,
    )
    .bind(
      expenseId,
      userId,
      input.templateId ?? null,
      input.accountId ?? null,
      input.type,
      input.category.trim(),
      input.isProjected ? 1 : 0,
      asNumber(input.amount),
      normalizeDate(input.movementDate),
      input.note.trim(),
      timestamp,
      timestamp,
    )
    .run()
}

export async function updateSettings(db: D1Database, userId: string, input: UserSettings) {
  await db
    .prepare(
      `INSERT INTO user_settings (user_id, cutoff_day, currency, timezone, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         cutoff_day = excluded.cutoff_day,
         currency = excluded.currency,
         timezone = excluded.timezone,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, clampDay(input.cutoffDay), input.currency.trim(), input.timezone.trim(), nowIso())
    .run()
}

export async function upsertGoogleUser(db: D1Database, profile: GoogleUserProfile): Promise<UserProfile> {
  const existing = await db
    .prepare(
      `SELECT id
       FROM users
       WHERE google_sub = ?`,
    )
    .bind(profile.sub)
    .first<{ id: string }>()

  const userId = existing?.id ?? crypto.randomUUID()
  const timestamp = nowIso()

  await db
    .prepare(
      `INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         google_sub = excluded.google_sub,
         email = excluded.email,
         name = excluded.name,
         avatar_url = excluded.avatar_url,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, profile.sub, profile.email, profile.name, profile.picture ?? null, timestamp, timestamp)
    .run()

  await ensureSettings(db, userId)

  return {
    id: userId,
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.picture,
  }
}

export async function createSession(db: D1Database, userId: string) {
  const sessionId = crypto.randomUUID()
  const createdAt = nowIso()
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()

  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(sessionId, userId, createdAt, expiresAt)
    .run()

  return sessionId
}

export async function deleteSession(db: D1Database, sessionId: string) {
  await db
    .prepare(
      `DELETE FROM sessions
       WHERE id = ?`,
    )
    .bind(sessionId)
    .run()
}

export async function getSessionUser(db: D1Database, sessionId: string) {
  return db
    .prepare(
      `SELECT users.id, users.email, users.name, users.avatar_url
       FROM sessions
       INNER JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ?
         AND sessions.expires_at > ?`,
    )
    .bind(sessionId, nowIso())
    .first<Record<string, unknown>>()
}
