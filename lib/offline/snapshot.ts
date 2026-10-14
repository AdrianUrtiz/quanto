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
  OfflineGroup,
  OfflineLineSum,
  OfflinePartnerDebt,
  OfflinePartnerShared,
  OfflineShare,
  OfflineSubscription,
  OfflineTransaction,
} from '@/lib/offline/db'

/** Solicitud de vínculo de pareja (solo nombre, sin datos privados). */
export type PairingInviteItem = {
  id: string
  fromName: string
}

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
  /** Resúmenes de mis grupos (tab Compartidos). Detalle online. */
  groups: OfflineGroup[]
  /** Mes actual "YYYY-MM" (hora-muro) con el que se tomó el snapshot. */
  currentMonth: string
  /** Pareja vinculada (solo nombre) o null: permite ofrecer "compartir". */
  partner: { id: string; name: string } | null
}
