import { buildDashboardSummary, getCycleRange, getTotalBalance, rolloverAppData } from '../ledger'
import type { AppData } from '../types'
import { describe, expect, it } from 'vitest'

const data: AppData = {
  accounts: [
    {
      id: 'a-1',
      name: 'Principal',
      openingBalance: 1000,
      color: '#7c3aed',
      isActive: true,
    },
  ],
  incomes: [
    {
      id: 'i-1',
      accountId: 'a-1',
      amount: 200,
      movementDate: '2026-05-25',
      note: 'Nomina',
      createdAt: '2026-05-25T08:00:00.000Z',
    },
    {
      id: 'i-2',
      accountId: 'a-1',
      amount: 120,
      movementDate: '2026-04-27',
      note: 'Extra',
      createdAt: '2026-04-27T08:00:00.000Z',
    },
  ],
  expenseTemplates: [
    {
      id: 't-1',
      name: 'Alquiler',
      defaultAmount: 500,
      category: 'Hogar',
      dueDay: 1,
      isActive: true,
    },
  ],
  expenses: [
    {
      id: 'e-1',
      type: 'fixed',
      templateId: 't-1',
      accountId: 'a-1',
      isProjected: false,
      amount: 500,
      movementDate: '2026-05-01',
      note: 'Pago alquiler',
      category: 'Hogar',
      createdAt: '2026-05-01T08:00:00.000Z',
    },
    {
      id: 'e-2',
      type: 'variable',
      accountId: 'a-1',
      isProjected: false,
      amount: 90,
      movementDate: '2026-05-11',
      note: 'Compra',
      category: 'Compras',
      createdAt: '2026-05-11T08:00:00.000Z',
    },
    {
      id: 'e-3',
      type: 'variable',
      accountId: 'a-1',
      isProjected: true,
      amount: 50,
      movementDate: '2026-05-22',
      note: 'Cena prevista',
      category: 'Ocio',
      createdAt: '2026-05-22T08:00:00.000Z',
    },
  ],
  settings: {
    cutoffDay: 25,
    currency: 'EUR',
    timezone: 'Europe/Madrid',
  },
  activeCycleEndDate: '2026-05-25',
  closedCycles: [],
}

describe('ledger domain', () => {
  it('calcula el ciclo segun el dia de corte', () => {
    const range = getCycleRange(new Date('2026-05-10T12:00:00'), 25)

    expect(range.startDate.toISOString()).toContain('2026-04-26')
    expect(range.endDate.toISOString()).toContain('2026-05-25')
  })

  it('calcula el saldo total acumulado', () => {
    expect(getTotalBalance(data)).toBe(680)
    expect(getTotalBalance(data, undefined, { includeProjected: false })).toBe(730)
  })

  it('construye resumen mensual y timeline del ciclo activo', () => {
    const summary = buildDashboardSummary(data, new Date('2026-05-14T12:00:00'))

    expect(summary.realBalance).toBe(730)
    expect(summary.projectedBalance).toBe(680)
    expect(summary.cycleIncome).toBe(320)
    expect(summary.cycleRealExpense).toBe(590)
    expect(summary.cycleProjectedExpense).toBe(50)
    expect(summary.cycleExpense).toBe(640)
    expect(summary.currentTimeline).toHaveLength(5)
    expect(summary.monthlyHistory.at(-1)?.balance).toBe(680)
    expect(summary.monthlyHistory.at(-1)?.realBalance).toBe(730)
  })

  it('cierra el ciclo anterior y arrastra el saldo real al nuevo', () => {
    const rolled = rolloverAppData(data, new Date('2026-05-26T12:00:00'))

    expect(rolled).not.toBeNull()
    expect(rolled?.activeCycleEndDate).toBe('2026-06-25')
    expect(rolled?.accounts[0]?.openingBalance).toBe(730)
    expect(rolled?.incomes).toHaveLength(0)
    expect(rolled?.expenses).toHaveLength(0)
    expect(rolled?.closedCycles[0]?.realClosingBalance).toBe(730)
    expect(rolled?.closedCycles[0]?.projectedClosingBalance).toBe(680)
  })
})
