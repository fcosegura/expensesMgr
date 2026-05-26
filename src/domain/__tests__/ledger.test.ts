import { buildDashboardSummary, getCycleRange, getTotalBalance } from '../ledger'
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
      amount: 90,
      movementDate: '2026-05-11',
      note: 'Compra',
      category: 'Compras',
      createdAt: '2026-05-11T08:00:00.000Z',
    },
  ],
  settings: {
    cutoffDay: 25,
    currency: 'EUR',
    timezone: 'Europe/Madrid',
  },
}

describe('ledger domain', () => {
  it('calcula el ciclo segun el dia de corte', () => {
    const range = getCycleRange(new Date('2026-05-10T12:00:00'), 25)

    expect(range.startDate.toISOString()).toContain('2026-04-26')
    expect(range.endDate.toISOString()).toContain('2026-05-25')
  })

  it('calcula el saldo total acumulado', () => {
    expect(getTotalBalance(data)).toBe(730)
  })

  it('construye resumen mensual y timeline del ciclo activo', () => {
    const summary = buildDashboardSummary(data, new Date('2026-05-14T12:00:00'))

    expect(summary.cycleIncome).toBe(320)
    expect(summary.cycleExpense).toBe(590)
    expect(summary.currentTimeline).toHaveLength(4)
    expect(summary.monthlyHistory.at(-1)?.balance).toBe(730)
  })
})
