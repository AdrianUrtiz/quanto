// Contrato del snapshot offline (cliente + servidor).
//
// Este archivo NO debe importar Prisma ni Dexie: lo usan el route
// `/api/snapshot`, `lib/offline/sync.ts` y (en la Etapa 2) los hooks
// de hidratación con `useLiveQuery`.
import type { CardPayCandidate } from '@/lib/card-pay'
import type {
  OfflineAccount,
  OfflineCategory,
  OfflineCharge,
  OfflineDebtPayment,
  OfflineLineSum,
  OfflinePartnerDebt,
  OfflinePartnerShared,
  OfflineShare,
  OfflineSubscription,
  OfflineTransaction,
} from '@/lib/offline/db'

export type SnapshotPayload = {
  v: number
  userId: string
  takenAt: string // ISO
  accounts: OfflineAccount[]
  transactions: OfflineTransaction[]
  shares: OfflineShare[]
  debtPayments: {
    toConfirm: OfflineDebtPayment[]
    myPending: OfflineDebtPayment[]
    toConfirmSource: OfflineDebtPayment[]
  }
  lineSums: OfflineLineSum[]
  catalog: OfflineCategory[]
  subscriptions: OfflineSubscription[]
  charges: OfflineCharge[]
  cardPayItems: CardPayCandidate[]
  /** Deudas de pareja: 'owe' = yo debo, 'owed' = me deben. */
  partnerDebts: OfflinePartnerDebt[]
  /** Compras compartidas de mi pareja en bruto (liquidación del Resumen). */
  partnerShared: OfflinePartnerShared[]
  /** Mes actual "YYYY-MM" (hora-muro) con el que se tomó el snapshot. */
  currentMonth: string
}
