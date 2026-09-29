import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ActivityKind, ActivityRange } from '@/lib/activity-filters'

type ResumenFiltersState = {
  /** Mes en formato YYYY-MM. Solo aplica cuando range === 'mensual'. */
  month: string
  kind: ActivityKind
  range: ActivityRange
  account: string
  category: string
  setMonth: (month: string) => void
  setKind: (kind: ActivityKind) => void
  setRange: (range: ActivityRange) => void
  setAccount: (account: string) => void
  setCategory: (category: string) => void
}

function currentMonthKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export const useResumenFilters = create<ResumenFiltersState>()(
  persist(
    (set) => ({
      month: currentMonthKey(),
      kind: 'gastos',
      range: 'mensual',
      account: 'todas',
      category: 'todas',
      setMonth: (month) => set({ month }),
      setKind: (kind) => set({ kind }),
      setRange: (range) => set({ range }),
      setAccount: (account) => set({ account }),
      setCategory: (category) => set({ category }),
    }),
    {
      name: 'quanto-resumen-filters',
    },
  ),
)

type StatementFiltersState = {
  /** Tarjeta seleccionada en "Estados de cuenta". Null = primera. */
  cardId: string | null
  /** Periodo seleccionado por tarjeta (cardId -> periodKey). */
  periodByCard: Record<string, string>
  setCardId: (cardId: string) => void
  setPeriod: (cardId: string, periodKey: string) => void
}

export const useStatementFilters = create<StatementFiltersState>()(
  persist(
    (set) => ({
      cardId: null,
      periodByCard: {},
      setCardId: (cardId) => set({ cardId }),
      setPeriod: (cardId, periodKey) =>
        set((s) => ({
          periodByCard: { ...s.periodByCard, [cardId]: periodKey },
        })),
    }),
    {
      name: 'quanto-statement-filters',
    },
  ),
)
