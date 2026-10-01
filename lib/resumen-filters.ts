import { create } from 'zustand'

import type { ActivityKind, ActivityRange } from '@/lib/activity-filters'
import { mexicoMonthKey } from '@/lib/walltime'

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
  return mexicoMonthKey()
}

export const useResumenFilters = create<ResumenFiltersState>()((set) => ({
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
}))

type StatementFiltersState = {
  /** Tarjeta seleccionada en "Estados de cuenta". Null = primera. */
  cardId: string | null
  /** Periodo seleccionado por tarjeta (cardId -> periodKey). */
  periodByCard: Record<string, string>
  setCardId: (cardId: string) => void
  setPeriod: (cardId: string, periodKey: string) => void
}

export const useStatementFilters = create<StatementFiltersState>()((set) => ({
  cardId: null,
  periodByCard: {},
  setCardId: (cardId) => set({ cardId }),
  setPeriod: (cardId, periodKey) =>
    set((s) => ({
      periodByCard: { ...s.periodByCard, [cardId]: periodKey },
    })),
}))
