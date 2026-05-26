import type { AppData, ExpenseEntry } from './types'

export interface CycleRange {
  startDate: Date
  endDate: Date
  label: string
}

export interface AccountBalanceItem {
  accountId: string
  accountName: string
  color: string
  openingBalance: number
  incomeTotal: number
  expenseTotal: number
  currentBalance: number
}

export interface MonthlySnapshot {
  label: string
  periodKey: string
  balance: number
  realBalance: number
  income: number
  expense: number
  projectedExpense: number
}

export interface TimelineEntry {
  id: string
  kind: 'income' | 'expense'
  title: string
  subtitle: string
  amount: number
  date: string
  isProjected?: boolean
}

export interface DashboardSummary {
  realBalance: number
  projectedBalance: number
  projectedExpenseImpact: number
  activeCycle: CycleRange
  cycleIncome: number
  cycleRealExpense: number
  cycleProjectedExpense: number
  cycleExpense: number
  realAvailable: number
  projectedAvailable: number
  projectedExpenseCount: number
  accountBalances: AccountBalanceItem[]
  monthlyHistory: MonthlySnapshot[]
  currentTimeline: TimelineEntry[]
}

function makeDate(year: number, month: number, day: number) {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, lastDay), 12, 0, 0, 0)
}

function addDays(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12, 0, 0, 0)
}

function shiftMonth(date: Date, amount: number, preferredDay = date.getDate()) {
  const seed = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12, 0, 0, 0)
  return makeDate(seed.getFullYear(), seed.getMonth(), preferredDay)
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function isWithinRange(value: string, range: CycleRange) {
  const date = parseDateOnly(value)
  return date >= range.startDate && date <= range.endDate
}

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat('es-ES', {
    month: 'short',
    year: '2-digit',
  }).format(date)
}

export function clampCutoffDay(value: number) {
  return Math.min(31, Math.max(1, Math.round(value)))
}

function filterExpenses(
  expenses: ExpenseEntry[],
  options?: {
    upToDate?: Date
    includeProjected?: boolean
  },
) {
  return expenses.filter((expense) => {
    if (options?.upToDate && parseDateOnly(expense.movementDate) > options.upToDate) {
      return false
    }

    if (options?.includeProjected === false && expense.isProjected) {
      return false
    }

    return true
  })
}

export function getCycleRange(anchorDate: Date, cutoffDay: number): CycleRange {
  const safeCutoffDay = clampCutoffDay(cutoffDay)
  const periodEndMonth = anchorDate.getDate() > safeCutoffDay ? 1 : 0
  const endSeed = shiftMonth(anchorDate, periodEndMonth, 1)
  const endDate = makeDate(endSeed.getFullYear(), endSeed.getMonth(), safeCutoffDay)
  const previousEndDate = shiftMonth(endDate, -1, safeCutoffDay)
  const startDate = addDays(previousEndDate, 1)

  return {
    startDate,
    endDate,
    label: `${formatMonthLabel(startDate)} - ${formatMonthLabel(endDate)}`,
  }
}

export function getTotalBalance(
  data: AppData,
  upToDate?: Date,
  options?: {
    includeProjected?: boolean
  },
) {
  const openingBalance = sum(data.accounts.filter((account) => account.isActive).map((account) => account.openingBalance))
  const incomes = sum(
    data.incomes
      .filter((income) => !upToDate || parseDateOnly(income.movementDate) <= upToDate)
      .map((income) => income.amount),
  )
  const expenses = sum(filterExpenses(data.expenses, { upToDate, includeProjected: options?.includeProjected }).map((expense) => expense.amount))

  return openingBalance + incomes - expenses
}

export function getAccountBalances(data: AppData): AccountBalanceItem[] {
  return data.accounts
    .filter((account) => account.isActive)
    .map((account) => {
      const incomeTotal = sum(
        data.incomes.filter((income) => income.accountId === account.id).map((income) => income.amount),
      )
      const expenseTotal = sum(
        data.expenses
          .filter((expense) => expense.accountId === account.id && !expense.isProjected)
          .map((expense) => expense.amount),
      )

      return {
        accountId: account.id,
        accountName: account.name,
        color: account.color,
        openingBalance: account.openingBalance,
        incomeTotal,
        expenseTotal,
        currentBalance: account.openingBalance + incomeTotal - expenseTotal,
      }
    })
    .sort((left, right) => right.currentBalance - left.currentBalance)
}

export function getMonthlyHistory(data: AppData, anchorDate = new Date(), points = 8): MonthlySnapshot[] {
  const currentCycle = getCycleRange(anchorDate, data.settings.cutoffDay)
  const history: MonthlySnapshot[] = []

  for (let offset = points - 1; offset >= 0; offset -= 1) {
    const monthAnchor = shiftMonth(currentCycle.endDate, -offset, currentCycle.endDate.getDate())
    const range = getCycleRange(monthAnchor, data.settings.cutoffDay)
    const income = sum(
      data.incomes.filter((incomeEntry) => isWithinRange(incomeEntry.movementDate, range)).map((incomeEntry) => incomeEntry.amount),
    )
    const expense = sum(
      data.expenses.filter((expenseEntry) => isWithinRange(expenseEntry.movementDate, range)).map((expenseEntry) => expenseEntry.amount),
    )
    const projectedExpense = sum(
      data.expenses
        .filter((expenseEntry) => expenseEntry.isProjected && isWithinRange(expenseEntry.movementDate, range))
        .map((expenseEntry) => expenseEntry.amount),
    )

    history.push({
      label: formatMonthLabel(range.endDate),
      periodKey: range.endDate.toISOString(),
      balance: getTotalBalance(data, range.endDate),
      realBalance: getTotalBalance(data, range.endDate, { includeProjected: false }),
      income,
      expense,
      projectedExpense,
    })
  }

  return history
}

function getExpenseTitle(expense: ExpenseEntry, data: AppData) {
  if (expense.templateId) {
    const template = data.expenseTemplates.find((entry) => entry.id === expense.templateId)
    if (template) {
      return template.name
    }
  }

  return expense.category
}

export function getCurrentTimeline(data: AppData, anchorDate = new Date()): TimelineEntry[] {
  const range = getCycleRange(anchorDate, data.settings.cutoffDay)
  const accountMap = new Map(data.accounts.map((account) => [account.id, account.name]))

  const incomes = data.incomes
    .filter((income) => isWithinRange(income.movementDate, range))
    .map<TimelineEntry>((income) => ({
      id: income.id,
      kind: 'income',
      title: income.note || 'Ingreso',
      subtitle: accountMap.get(income.accountId) ?? 'Cuenta',
      amount: income.amount,
      date: income.movementDate,
    }))

  const expenses = data.expenses
    .filter((expense) => isWithinRange(expense.movementDate, range))
    .map<TimelineEntry>((expense) => ({
      id: expense.id,
      kind: 'expense',
      title: getExpenseTitle(expense, data),
      subtitle: expense.isProjected
        ? `Proyectado · ${expense.note || expense.category}`
        : expense.note || expense.category,
      amount: expense.amount,
      date: expense.movementDate,
      isProjected: expense.isProjected,
    }))

  return [...incomes, ...expenses].sort((left, right) => right.date.localeCompare(left.date))
}

export function getCycleBreakdown(data: AppData, anchorDate = new Date()) {
  const activeCycle = getCycleRange(anchorDate, data.settings.cutoffDay)
  const cycleIncome = sum(
    data.incomes.filter((income) => isWithinRange(income.movementDate, activeCycle)).map((income) => income.amount),
  )
  const cycleRealExpense = sum(
    data.expenses
      .filter((expense) => !expense.isProjected && isWithinRange(expense.movementDate, activeCycle))
      .map((expense) => expense.amount),
  )
  const cycleProjectedExpense = sum(
    data.expenses
      .filter((expense) => expense.isProjected && isWithinRange(expense.movementDate, activeCycle))
      .map((expense) => expense.amount),
  )
  const cycleExpense = cycleRealExpense + cycleProjectedExpense

  return {
    activeCycle,
    cycleIncome,
    cycleRealExpense,
    cycleProjectedExpense,
    cycleExpense,
    realAvailable: cycleIncome - cycleRealExpense,
    projectedAvailable: cycleIncome - cycleExpense,
  }
}

export function buildDashboardSummary(data: AppData, anchorDate = new Date()): DashboardSummary {
  const cycle = getCycleBreakdown(data, anchorDate)
  const realBalance = getTotalBalance(data, undefined, { includeProjected: false })
  const projectedBalance = getTotalBalance(data)

  return {
    realBalance,
    projectedBalance,
    projectedExpenseImpact: realBalance - projectedBalance,
    activeCycle: cycle.activeCycle,
    cycleIncome: cycle.cycleIncome,
    cycleRealExpense: cycle.cycleRealExpense,
    cycleProjectedExpense: cycle.cycleProjectedExpense,
    cycleExpense: cycle.cycleExpense,
    realAvailable: cycle.realAvailable,
    projectedAvailable: cycle.projectedAvailable,
    projectedExpenseCount: data.expenses.filter((expense) => expense.isProjected).length,
    accountBalances: getAccountBalances(data),
    monthlyHistory: getMonthlyHistory(data, anchorDate),
    currentTimeline: getCurrentTimeline(data, anchorDate),
  }
}
