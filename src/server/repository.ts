import type {
  AccountInput,
  AppData,
  ClosedCycle,
  ExpenseInput,
  ExpenseTemplateInput,
  IncomeInput,
  UserProfile,
  UserSettings,
} from '../domain/types'
import { getCycleEndDateKey, rolloverAppData } from '../domain/ledger'

const DEFAULT_SETTINGS: UserSettings = {
  cutoffDay: 25,
  currency: 'EUR',
  timezone: 'Europe/Madrid',
}

let dbSchemaEnsured = false

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

async function tableExists(db: D1Database, table: string) {
  const row = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .bind(table)
    .first<{ name: string }>()
  return Boolean(row)
}

async function columnExists(db: D1Database, table: string, column: string) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  const rows = info.results ?? []
  return rows.some((r) => r.name === column)
}

async function ensureDbInitialized(db: D1Database) {
  // Avoid repeated introspection + schema checks on every request within the same worker instance.
  if (dbSchemaEnsured) return

  await db.prepare(`PRAGMA foreign_keys = ON;`).run()

  const hasUsersTable = await tableExists(db, 'users')
  const hasExpensesTable = await tableExists(db, 'expenses')
  const hasUserSettingsTable = await tableExists(db, 'user_settings')

  const statements: D1PreparedStatement[] = []

  // Base schema (equivalent to migrations/0001_init.sql, using IF NOT EXISTS for safety).
  if (!hasUsersTable) {
    statements.push(
      db.prepare(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        google_sub TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        avatar_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        opening_balance REAL NOT NULL DEFAULT 0,
        color TEXT NOT NULL DEFAULT '#7c3aed',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS incomes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        amount REAL NOT NULL,
        movement_date TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS expense_templates (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        default_amount REAL NOT NULL,
        category TEXT NOT NULL,
        due_day INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        template_id TEXT,
        account_id TEXT,
        type TEXT NOT NULL CHECK (type IN ('fixed', 'variable')),
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        movement_date TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (template_id) REFERENCES expense_templates(id) ON DELETE SET NULL,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        cutoff_day INTEGER NOT NULL DEFAULT 25,
        currency TEXT NOT NULL DEFAULT 'EUR',
        timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
        updated_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_incomes_user_id_date ON incomes(user_id, movement_date DESC)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_templates_user_id ON expense_templates(user_id)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_expenses_user_id_date ON expenses(user_id, movement_date DESC)`),
    )
  }

  // Closed cycles table (equivalent to migrations/0003_add_cycle_archives.sql)
  statements.push(
    db.prepare(`CREATE TABLE IF NOT EXISTS closed_cycles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      cycle_start_date TEXT NOT NULL,
      cycle_end_date TEXT NOT NULL,
      label TEXT NOT NULL,
      closed_at TEXT NOT NULL,
      real_closing_balance REAL NOT NULL,
      projected_closing_balance REAL NOT NULL,
      income_total REAL NOT NULL,
      real_expense_total REAL NOT NULL,
      projected_expense_total REAL NOT NULL,
      account_balances_json TEXT NOT NULL,
      incomes_json TEXT NOT NULL,
      expenses_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_closed_cycles_user_end ON closed_cycles(user_id, cycle_end_date DESC)`),
  )

  // Column migrations with guards (migrations/0002_add_projected_expenses.sql + column added in 0002)
  if (hasExpensesTable) {
    const hasIsProjected = await columnExists(db, 'expenses', 'is_projected')
    if (!hasIsProjected) {
      statements.push(db.prepare(`ALTER TABLE expenses ADD COLUMN is_projected INTEGER NOT NULL DEFAULT 0`))
    }
  }

  if (hasUserSettingsTable) {
    const hasActiveCycleEndDate = await columnExists(db, 'user_settings', 'active_cycle_end_date')
    if (!hasActiveCycleEndDate) {
      statements.push(db.prepare(`ALTER TABLE user_settings ADD COLUMN active_cycle_end_date TEXT`))
    }
  }

  if (statements.length > 0) {
    await db.batch(statements)
  }

  dbSchemaEnsured = true
}

export async function ensureDatabaseReady(db: D1Database) {
  await ensureDbInitialized(db)
}

export async function ensureSettings(db: D1Database, userId: string) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO user_settings (user_id, cutoff_day, currency, timezone, active_cycle_end_date, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      userId,
      DEFAULT_SETTINGS.cutoffDay,
      DEFAULT_SETTINGS.currency,
      DEFAULT_SETTINGS.timezone,
      getCycleEndDateKey(new Date(), DEFAULT_SETTINGS.cutoffDay),
      nowIso(),
    )
    .run()
}

async function loadAppData(db: D1Database, userId: string): Promise<AppData> {
  const [accounts, incomes, expenseTemplates, expenses, settings, closedCyclesRows] = await Promise.all([
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
        `SELECT cutoff_day, currency, timezone, active_cycle_end_date
         FROM user_settings
         WHERE user_id = ?`,
      )
      .bind(userId)
      .first<Record<string, unknown>>(),
    listResults<Record<string, unknown>>(
      db
        .prepare(
          `SELECT id, cycle_start_date, cycle_end_date, label, closed_at, real_closing_balance, projected_closing_balance,
                  income_total, real_expense_total, projected_expense_total, account_balances_json, incomes_json, expenses_json
           FROM closed_cycles
           WHERE user_id = ?
           ORDER BY cycle_end_date DESC`,
        )
        .bind(userId),
    ),
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
    activeCycleEndDate: String(settings?.active_cycle_end_date ?? ''),
    closedCycles: closedCyclesRows.map((row) => ({
      id: String(row.id),
      startDate: String(row.cycle_start_date),
      endDate: String(row.cycle_end_date),
      label: String(row.label),
      closedAt: String(row.closed_at),
      realClosingBalance: asNumber(row.real_closing_balance),
      projectedClosingBalance: asNumber(row.projected_closing_balance),
      incomeTotal: asNumber(row.income_total),
      realExpenseTotal: asNumber(row.real_expense_total),
      projectedExpenseTotal: asNumber(row.projected_expense_total),
      accountBalances: JSON.parse(String(row.account_balances_json)),
      incomes: JSON.parse(String(row.incomes_json)),
      expenses: JSON.parse(String(row.expenses_json)),
    })),
  }
}

async function persistCycleState(
  db: D1Database,
  userId: string,
  currentData: AppData,
  nextData: AppData,
) {
  const updateTimestamp = nowIso()
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE user_settings
         SET active_cycle_end_date = ?, updated_at = ?
         WHERE user_id = ?`,
      )
      .bind(nextData.activeCycleEndDate, updateTimestamp, userId),
  ]

  if (currentData.activeCycleEndDate !== nextData.activeCycleEndDate) {
    const newClosedCycle = nextData.closedCycles[0] as ClosedCycle | undefined

    if (newClosedCycle) {
      statements.unshift(
        db
          .prepare(
            `INSERT INTO closed_cycles (
                id, user_id, cycle_start_date, cycle_end_date, label, closed_at,
                real_closing_balance, projected_closing_balance, income_total,
                real_expense_total, projected_expense_total, account_balances_json,
                incomes_json, expenses_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            newClosedCycle.id,
            userId,
            newClosedCycle.startDate,
            newClosedCycle.endDate,
            newClosedCycle.label,
            newClosedCycle.closedAt,
            newClosedCycle.realClosingBalance,
            newClosedCycle.projectedClosingBalance,
            newClosedCycle.incomeTotal,
            newClosedCycle.realExpenseTotal,
            newClosedCycle.projectedExpenseTotal,
            JSON.stringify(newClosedCycle.accountBalances),
            JSON.stringify(newClosedCycle.incomes),
            JSON.stringify(newClosedCycle.expenses),
            updateTimestamp,
          ),
        db.prepare(`DELETE FROM incomes WHERE user_id = ?`).bind(userId),
        db.prepare(`DELETE FROM expenses WHERE user_id = ?`).bind(userId),
      )

      for (const account of nextData.accounts) {
        statements.unshift(
          db
            .prepare(
              `UPDATE accounts
               SET opening_balance = ?, updated_at = ?
               WHERE id = ? AND user_id = ?`,
            )
            .bind(account.openingBalance, updateTimestamp, account.id, userId),
        )
      }
    }
  }

  await db.batch(statements)
}

export async function getAppData(db: D1Database, userId: string): Promise<AppData> {
  await ensureDbInitialized(db)
  await ensureSettings(db, userId)

  const currentData = await loadAppData(db, userId)
  const rolledData = rolloverAppData(currentData)

  if (rolledData) {
    await persistCycleState(db, userId, currentData, rolledData)
    return loadAppData(db, userId)
  }

  return currentData
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
  const nextCutoffDay = clampDay(input.cutoffDay)

  await db
    .prepare(
      `INSERT INTO user_settings (user_id, cutoff_day, currency, timezone, active_cycle_end_date, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         cutoff_day = excluded.cutoff_day,
         currency = excluded.currency,
         timezone = excluded.timezone,
         active_cycle_end_date = excluded.active_cycle_end_date,
         updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      nextCutoffDay,
      input.currency.trim(),
      input.timezone.trim(),
      getCycleEndDateKey(new Date(), nextCutoffDay),
      nowIso(),
    )
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
  await ensureDbInitialized(db)
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
