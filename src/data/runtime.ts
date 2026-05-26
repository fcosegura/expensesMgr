import type {
  Account,
  AccountInput,
  AppData,
  ExpenseEntry,
  ExpenseInput,
  ExpenseTemplate,
  ExpenseTemplateInput,
  IncomeEntry,
  IncomeInput,
  RuntimeMode,
  UserSession,
  UserSettings,
} from '../domain/types'

const STORAGE_KEY = 'expensesmgr.qa.v1'

const DEFAULT_SETTINGS: UserSettings = {
  cutoffDay: 25,
  currency: 'EUR',
  timezone: 'Europe/Madrid',
}

function nowIso() {
  return new Date().toISOString()
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function createSeedData(): AppData {
  const currentDate = new Date()
  const currentMonth = String(currentDate.getMonth() + 1).padStart(2, '0')
  const previousMonthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 20, 12, 0, 0, 0)
  const previousMonth = String(previousMonthDate.getMonth() + 1).padStart(2, '0')
  const currentYear = currentDate.getFullYear()
  const previousYear = previousMonthDate.getFullYear()

  const accounts: Account[] = [
    {
      id: crypto.randomUUID(),
      name: 'Cuenta principal',
      openingBalance: 1450,
      color: '#7c3aed',
      isActive: true,
    },
    {
      id: crypto.randomUUID(),
      name: 'Ahorro',
      openingBalance: 3200,
      color: '#0ea5e9',
      isActive: true,
    },
  ]

  const templates: ExpenseTemplate[] = [
    {
      id: crypto.randomUUID(),
      name: 'Alquiler',
      defaultAmount: 850,
      category: 'Hogar',
      dueDay: 1,
      isActive: true,
    },
    {
      id: crypto.randomUUID(),
      name: 'Internet',
      defaultAmount: 38,
      category: 'Servicios',
      dueDay: 12,
      isActive: true,
    },
  ]

  const incomes: IncomeEntry[] = [
    {
      id: crypto.randomUUID(),
      accountId: accounts[0].id,
      amount: 2100,
      movementDate: `${currentYear}-${currentMonth}-25`,
      note: 'Nomina',
      createdAt: nowIso(),
    },
    {
      id: crypto.randomUUID(),
      accountId: accounts[1].id,
      amount: 250,
      movementDate: `${currentYear}-${currentMonth}-08`,
      note: 'Ingreso extra',
      createdAt: nowIso(),
    },
    {
      id: crypto.randomUUID(),
      accountId: accounts[0].id,
      amount: 2100,
      movementDate: `${previousYear}-${previousMonth}-25`,
      note: 'Nomina anterior',
      createdAt: nowIso(),
    },
  ]

  const expenses: ExpenseEntry[] = [
    {
      id: crypto.randomUUID(),
      type: 'fixed',
      templateId: templates[0].id,
      accountId: accounts[0].id,
      amount: 850,
      movementDate: `${currentYear}-${currentMonth}-01`,
      note: 'Transferencia realizada',
      category: 'Hogar',
      createdAt: nowIso(),
    },
    {
      id: crypto.randomUUID(),
      type: 'variable',
      accountId: accounts[0].id,
      amount: 72.5,
      movementDate: `${currentYear}-${currentMonth}-16`,
      note: 'Supermercado',
      category: 'Compras',
      createdAt: nowIso(),
    },
    {
      id: crypto.randomUUID(),
      type: 'fixed',
      templateId: templates[1].id,
      accountId: accounts[0].id,
      amount: 38,
      movementDate: `${previousYear}-${previousMonth}-12`,
      note: 'Factura mensual',
      category: 'Servicios',
      createdAt: nowIso(),
    },
  ]

  return {
    accounts,
    incomes,
    expenseTemplates: templates,
    expenses,
    settings: DEFAULT_SETTINGS,
  }
}

function cloneData(data: AppData): AppData {
  return {
    accounts: [...data.accounts],
    incomes: [...data.incomes],
    expenseTemplates: [...data.expenseTemplates],
    expenses: [...data.expenses],
    settings: { ...data.settings },
  }
}

function sortDescendingByDate<T extends { movementDate: string }>(values: T[]) {
  return [...values].sort((left, right) => right.movementDate.localeCompare(left.movementDate))
}

function normalizeData(data: AppData): AppData {
  return {
    accounts: [...data.accounts].sort((left, right) => left.name.localeCompare(right.name)),
    incomes: sortDescendingByDate(data.incomes),
    expenseTemplates: [...data.expenseTemplates].sort((left, right) => left.name.localeCompare(right.name)),
    expenses: sortDescendingByDate(data.expenses),
    settings: {
      cutoffDay: Math.min(31, Math.max(1, Math.round(data.settings.cutoffDay))),
      currency: data.settings.currency || DEFAULT_SETTINGS.currency,
      timezone: data.settings.timezone || DEFAULT_SETTINGS.timezone,
    },
  }
}

function readQaData() {
  const raw = window.localStorage.getItem(STORAGE_KEY)

  if (!raw) {
    const seed = createSeedData()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
    return seed
  }

  return normalizeData(JSON.parse(raw) as AppData)
}

function writeQaData(data: AppData) {
  const normalized = normalizeData(data)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

async function simulateLatency() {
  await new Promise((resolve) => window.setTimeout(resolve, 120))
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(input, {
    credentials: 'same-origin',
    headers,
    ...init,
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'No se pudo completar la operacion.')
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export interface AppRepository {
  mode: RuntimeMode
  getSession: () => Promise<UserSession>
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  getData: () => Promise<AppData>
  upsertAccount: (input: AccountInput) => Promise<AppData>
  addIncome: (input: IncomeInput) => Promise<AppData>
  upsertExpenseTemplate: (input: ExpenseTemplateInput) => Promise<AppData>
  upsertExpense: (input: ExpenseInput) => Promise<AppData>
  updateSettings: (input: UserSettings) => Promise<AppData>
  resetQaData?: () => Promise<AppData>
}

const qaSession: UserSession = {
  mode: 'qa',
  isAuthenticated: true,
  user: {
    id: 'qa-user',
    name: 'Modo QA',
    email: 'qa@expensesmgr.local',
  },
}

function buildQaRepository(): AppRepository {
  return {
    mode: 'qa',
    async getSession() {
      await simulateLatency()
      return qaSession
    },
    async signIn() {
      await simulateLatency()
    },
    async signOut() {
      await simulateLatency()
    },
    async getData() {
      await simulateLatency()
      return cloneData(readQaData())
    },
    async upsertAccount(input) {
      await simulateLatency()
      const current = readQaData()
      const nextAccounts = [...current.accounts]
      const existingIndex = nextAccounts.findIndex((account) => account.id === input.id)
      const nextAccount: Account = {
        id: input.id ?? crypto.randomUUID(),
        name: input.name.trim(),
        openingBalance: Number(input.openingBalance),
        color: input.color,
        isActive: input.isActive,
      }

      if (existingIndex >= 0) {
        nextAccounts[existingIndex] = nextAccount
      } else {
        nextAccounts.push(nextAccount)
      }

      return writeQaData({ ...current, accounts: nextAccounts })
    },
    async addIncome(input) {
      await simulateLatency()
      const current = readQaData()
      const nextIncome: IncomeEntry = {
        id: crypto.randomUUID(),
        accountId: input.accountId,
        amount: Number(input.amount),
        movementDate: input.movementDate || today(),
        note: input.note.trim(),
        createdAt: nowIso(),
      }

      return writeQaData({ ...current, incomes: [nextIncome, ...current.incomes] })
    },
    async upsertExpenseTemplate(input) {
      await simulateLatency()
      const current = readQaData()
      const nextTemplates = [...current.expenseTemplates]
      const existingIndex = nextTemplates.findIndex((template) => template.id === input.id)
      const nextTemplate: ExpenseTemplate = {
        id: input.id ?? crypto.randomUUID(),
        name: input.name.trim(),
        defaultAmount: Number(input.defaultAmount),
        category: input.category.trim(),
        dueDay: Number(input.dueDay),
        isActive: input.isActive,
      }

      if (existingIndex >= 0) {
        nextTemplates[existingIndex] = nextTemplate
      } else {
        nextTemplates.push(nextTemplate)
      }

      return writeQaData({ ...current, expenseTemplates: nextTemplates })
    },
    async upsertExpense(input) {
      await simulateLatency()
      const current = readQaData()
      const nextExpenses = [...current.expenses]
      const existingIndex = nextExpenses.findIndex((expense) => expense.id === input.id)
      const nextExpense: ExpenseEntry = {
        id: input.id ?? crypto.randomUUID(),
        type: input.type,
        templateId: input.templateId || undefined,
        accountId: input.accountId || undefined,
        amount: Number(input.amount),
        movementDate: input.movementDate || today(),
        note: input.note.trim(),
        category: input.category.trim(),
        createdAt: existingIndex >= 0 ? nextExpenses[existingIndex].createdAt : nowIso(),
      }

      if (existingIndex >= 0) {
        nextExpenses[existingIndex] = nextExpense
      } else {
        nextExpenses.push(nextExpense)
      }

      return writeQaData({ ...current, expenses: nextExpenses })
    },
    async updateSettings(input) {
      await simulateLatency()
      const current = readQaData()
      return writeQaData({
        ...current,
        settings: {
          cutoffDay: Number(input.cutoffDay),
          currency: input.currency.trim(),
          timezone: input.timezone.trim(),
        },
      })
    },
    async resetQaData() {
      await simulateLatency()
      const seed = createSeedData()
      return writeQaData(seed)
    },
  }
}

function buildApiRepository(): AppRepository {
  return {
    mode: 'prod',
    async getSession() {
      return fetchJson<UserSession>('/api/session')
    },
    async signIn() {
      window.location.assign('/api/auth/login')
    },
    async signOut() {
      await fetchJson('/api/auth/logout', { method: 'POST' })
    },
    async getData() {
      return fetchJson<AppData>('/api/data')
    },
    async upsertAccount(input) {
      await fetchJson('/api/accounts', { method: 'POST', body: JSON.stringify(input) })
      return fetchJson<AppData>('/api/data')
    },
    async addIncome(input) {
      await fetchJson('/api/incomes', { method: 'POST', body: JSON.stringify(input) })
      return fetchJson<AppData>('/api/data')
    },
    async upsertExpenseTemplate(input) {
      await fetchJson('/api/expense-templates', { method: 'POST', body: JSON.stringify(input) })
      return fetchJson<AppData>('/api/data')
    },
    async upsertExpense(input) {
      await fetchJson('/api/expenses', { method: 'POST', body: JSON.stringify(input) })
      return fetchJson<AppData>('/api/data')
    },
    async updateSettings(input) {
      await fetchJson('/api/settings', { method: 'PUT', body: JSON.stringify(input) })
      return fetchJson<AppData>('/api/data')
    },
  }
}

export function getRuntimeMode(): RuntimeMode {
  const mode = import.meta.env.VITE_APP_MODE
  return mode === 'prod' ? 'prod' : 'qa'
}

export function createRepository() {
  return getRuntimeMode() === 'prod' ? buildApiRepository() : buildQaRepository()
}
