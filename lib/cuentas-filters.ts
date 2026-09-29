import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type CuentasFiltersState = {
  /** Tab activa de Cuentas. */
  tab: string
  /** Tab Todas: sección visible + orden. */
  allSection: string
  allSort: string
  /** Tab Cuentas: orden + tipo/estado. */
  accSort: string
  accType: string
  /** Tab Pareja: mes seleccionado en formato YYYY-MM. */
  partnerMonth: string
  setTab: (tab: string) => void
  setAllSection: (v: string) => void
  setAllSort: (v: string) => void
  setAccSort: (v: string) => void
  setAccType: (v: string) => void
  setPartnerMonth: (month: string) => void
}

function currentMonthKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export const useCuentasFilters = create<CuentasFiltersState>()(
  persist(
    (set) => ({
      tab: 'todas',
      allSection: 'all',
      allSort: 'default',
      accSort: 'default',
      accType: 'all',
      partnerMonth: currentMonthKey(),
      setTab: (tab) => set({ tab }),
      setAllSection: (allSection) => set({ allSection }),
      setAllSort: (allSort) => set({ allSort }),
      setAccSort: (accSort) => set({ accSort }),
      setAccType: (accType) => set({ accType }),
      setPartnerMonth: (partnerMonth) => set({ partnerMonth }),
    }),
    {
      name: 'quanto-cuentas-filters',
    },
  ),
)
