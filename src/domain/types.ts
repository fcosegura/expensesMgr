export type RuntimeMode = 'qa' | 'prod'

export type ExpenseType = 'fixed' | 'variable'

export interface UserProfile {
  id: string
  name: string
  email: string
  avatarUrl?: string
}

export interface UserSession {
  mode: RuntimeMode
  isAuthenticated: boolean
  user: UserProfile | null
  oauth?: {
    loginUrl: string
    redirectUri: string
    googleConfigured: boolean
  }
}

export interface Account {
  id: string
  name: string
  openingBalance: number
  color: string
  isActive: boolean
}

export interface IncomeEntry {
  id: string
  accountId: string
  amount: number
  movementDate: string
  note: string
  createdAt: string
}

export interface ExpenseTemplate {
  id: string
  name: string
  defaultAmount: number
  category: string
  dueDay: number
  isActive: boolean
}

export interface ExpenseEntry {
  id: string
  type: ExpenseType
  templateId?: string
  accountId?: string
  isProjected: boolean
  amount: number
  movementDate: string
  note: string
  category: string
  createdAt: string
}

export interface UserSettings {
  cutoffDay: number
  currency: string
  timezone: string
}

export interface ClosedCycleAccountSnapshot {
  accountId: string
  accountName: string
  color: string
  closingBalance: number
}

export interface ClosedCycle {
  id: string
  startDate: string
  endDate: string
  label: string
  closedAt: string
  realClosingBalance: number
  projectedClosingBalance: number
  incomeTotal: number
  realExpenseTotal: number
  projectedExpenseTotal: number
  accountBalances: ClosedCycleAccountSnapshot[]
  incomes: IncomeEntry[]
  expenses: ExpenseEntry[]
}

export interface AppData {
  accounts: Account[]
  incomes: IncomeEntry[]
  expenseTemplates: ExpenseTemplate[]
  expenses: ExpenseEntry[]
  settings: UserSettings
  activeCycleEndDate: string
  closedCycles: ClosedCycle[]
}

export interface AccountInput {
  id?: string
  name: string
  openingBalance: number
  color: string
  isActive: boolean
}

export interface IncomeInput {
  accountId: string
  amount: number
  movementDate: string
  note: string
}

export interface ExpenseTemplateInput {
  id?: string
  name: string
  defaultAmount: number
  category: string
  dueDay: number
  isActive: boolean
}

export interface ExpenseInput {
  id?: string
  type: ExpenseType
  templateId?: string
  accountId?: string
  isProjected: boolean
  amount: number
  movementDate: string
  note: string
  category: string
}
