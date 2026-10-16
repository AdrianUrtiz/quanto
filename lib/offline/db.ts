// Tándem offline — IndexedDB con Dexie (Etapa 1: sincronización, solo lectura).
//
// Este módulo es cliente (`useLiveQuery` lo consume desde los *Client).
// No importar Prisma ni server actions desde aquí.
import Dexie, { type Table } from 'dexie'

import type { CardPayCandidate } from '@/lib/card-pay'

// Versión del esquema Dexie. Subir en cada migración futura
// (el sprint de creación offline añadirá índices/flags sin romper v2).
export const DB_VERSION = 7
export const DB_NAME = 'tandem-db'
// Versión del payload de /api/snapshot que esta DB sabe guardar.
export const SNAPSHOT_VERSION = 7

export type SyncMeta = {
  key: string // siempre 'sync'
  userId: string
  lastSyncAt: string // ISO
  snapshotVersion: number
  /** Pareja vinculada (solo nombre) o null. Para ofrecer "compartir". */
  partner?: { id: string; name: string } | null
}

export type OfflineAccount = {
  id: string
  name: string
  type: 'DEBIT' | 'CREDIT'
  owner: string
  ownerId: string
  balance: number
  creditLimit?: number
  statementDay?: number
  dueDay?: number
  lastFour?: string
  expiry?: string
  color: string
  isHidden: boolean
  position: number
  isFavorite: boolean
  updatedAt: string // ISO, para futura detección de cambios locales
}

export type OfflineTransaction = {
  id: string
  concept: string
  category: string
  amount: number
  /** ISO — en Dexie siempre string para poder indexar/ordenar. */
  date: string
  type: string
  accountId: string
  accountName: string
  accountType: string
  transferToAccountId?: string | null
  transferToAccountName?: string | null
  transferToAccountType?: string | null
  creatorName: string
  createdById: string
  installments: number
  isShared: boolean
  /** Reparto actual de un gasto compartido mío (prefill de edición). */
  sharePct?: number
  shareMonthly?: number
  shareFixed?: boolean
  /** Nombre de la persona sin cuenta si el compartido es externo. */
  shareExternalName?: string | null
  /** Gasto de un grupo (household): su reparto no se edita en el formulario. */
  isGroup?: boolean
  /** Período ("YYYY-MM") al que se aplica un pago aunque sea extemporáneo. */
  statementKey?: string | null
  /** Fila derivada de un gasto compartido de mi pareja (solo lectura). */
  partnerShare?: boolean
  locked?: boolean
  updatedAt: string // ISO
}

export type OfflineShare = {
  id: string
  transactionId: string
  /** null = persona sin cuenta (compartido "de recordatorio"). */
  debtorId: string | null
  debtorName: string
  sharePct: number
  monthlyAmount: number
  isFixedAmount: boolean
}

export type OfflineDebtPayment = {
  id: string
  shareId: string
  month: string // "YYYY-MM"
  amount: number
  status: 'PENDING' | 'CONFIRMED'
  registeredById: string
  registeredByName: string
  concept: string
  monthly: number
  monthLabel: string
}

export type OfflineLineSum = {
  /** `${shareId}:${month}` */
  key: string
  confirmed: number
  pending: number
}

export type OfflineCategory = {
  code: string
  name: string
  iconName: string
  color: string
  kind: string
  isDefault: boolean
  mine: boolean
}

export type OfflineSubscription = {
  id: string
  name: string
  amount: number
  category: string
  accountId: string
  accountName: string
  accountType: 'DEBIT' | 'CREDIT'
  chargeDay: number
  isShared: boolean
  sharePct: number
  shareAmount: number | null
  isActive: boolean
  startMonth: string
  ownerName: string
  isMine: boolean
  partnerName: string | null
  /** Compartida con alguien sin cuenta (ej. "Mamá"). */
  externalName: string | null
}

// Entrada de deuda de pareja (compatible con DebtItemInput/PartnerPayItem).
// Solo mínimos desnormalizados: nunca saldos ni cuentas privadas ajenas.
export type OfflinePartnerDebt = {
  shareId: string
  accountId: string
  accountName: string
  accountType: 'DEBIT' | 'CREDIT'
  dueDay?: number | null
  statementDay?: number | null
  /** null = persona sin cuenta (compartido "de recordatorio"). */
  debtorId: string | null
  debtorName: string
  creditorName: string
  concept: string
  monthly: number
  installments: number
  /** ISO */
  date: string
  /** 'owe' = yo debo · 'owed' = me deben */
  direction: 'owe' | 'owed'
}

// Compra compartida de mi pareja en bruto (para Resumen > liquidación).
// Solo mínimos: sin movimientos de sus cuentas, solo mi parte vía shares.
export type OfflinePartnerShared = {
  id: string
  concept: string
  /** Total de la compra (la cuota sale de shares.mensual). */
  amount: number
  installments: number
  /** ISO */
  date: string
  createdById: string
  creatorName: string
  statementDay?: number | null
  dueDay?: number | null
}

// Resumen de grupo para la tab Compartidos (serializable; lo calcula el
// servidor en el snapshot y en /cuentas, el cliente lo pinta tal cual).
export type OfflineGroup = {
  id: string
  code: string | null
  name: string
  status?: 'ACTIVE' | 'CLOSED'
  isCreator: boolean
  memberCount: number
  memberNames: string[]
  myOwe: number
  myOwed: number
  expenseCount: number
}

// Presupuesto mensual: solo lo manual (ingreso base, fijos y límites).
// El comprometido automático (MSI + suscripciones + pareja) se deriva en
// cliente desde las tablas ya descargadas. Solo lectura: las mutaciones
// siguen siendo online.
export type OfflineBudget = {
  /** Mes "YYYY-MM". */
  month: string
  baseIncome: number
  /** ISO */
  updatedAt: string
}

export type OfflineBudgetItem = {
  id: string
  /** Mes "YYYY-MM" (desnormalizado para filtrar sin join). */
  month: string
  label: string
  amount: number
  accountId: string | null
  /** ISO (para ordenar igual que el servidor: createdAt asc). */
  createdAt: string
}

export type OfflineBudgetLimit = {
  /** Mes "YYYY-MM" (desnormalizado para filtrar sin join). */
  month: string
  category: string
  limit: number
}

// Reserva para el sprint de creación offline: cola de operaciones
// pendientes de subir a la central. `error` guarda el último rechazo del
// servidor (p. ej. cuenta eliminada) para la tarjeta de acciones urgentes.
// Campos no indexados: añadirlos no requiere subir DB_VERSION.
export type OfflineOutboxOp = {
  localId?: number
  kind: string
  payload: string // JSON
  createdAt: string // ISO
  status: 'PENDING' | 'SENDING' | 'FAILED'
  /** Último error del servidor (solo en FAILED). */
  error?: string | null
}

class TandemDB extends Dexie {
  meta!: Table<SyncMeta, string>
  accounts!: Table<OfflineAccount, string>
  transactions!: Table<OfflineTransaction, string>
  shares!: Table<OfflineShare, string>
  debtPayments!: Table<OfflineDebtPayment, string>
  lineSums!: Table<OfflineLineSum, string>
  categories!: Table<OfflineCategory, string>
  subscriptions!: Table<OfflineSubscription, string>
  charges!: Table<OfflineCharge, string>
  partnerDebts!: Table<OfflinePartnerDebt, string>
  cardPay!: Table<CardPayCandidate, string>
  partnerShared!: Table<OfflinePartnerShared, string>
  groups!: Table<OfflineGroup, string>
  budgets!: Table<OfflineBudget, string>
  budgetItems!: Table<OfflineBudgetItem, string>
  budgetLimits!: Table<OfflineBudgetLimit, [string, string]>
  outbox!: Table<OfflineOutboxOp, number>

  constructor() {
    super(DB_NAME)
    this.version(DB_VERSION).stores({
      meta: 'key',
      accounts: 'id',
      transactions: 'id, date, accountId, type',
      shares: 'id, transactionId, debtorId',
      debtPayments: 'id, shareId, month, status',
      lineSums: 'key',
      categories: 'code',
      subscriptions: 'id',
      charges: '[subscriptionId+month], subscriptionId, month',
      partnerDebts: 'shareId, direction',
      cardPay: 'cardId',
      partnerShared: 'id',
      groups: 'id',
      budgets: 'month',
      budgetItems: 'id, month',
      budgetLimits: '[month+category], month',
      outbox: '++localId, createdAt, status',
    })
  }
}

export type OfflineCharge = {
  /** `${subscriptionId}:${month}` */
  key: string
  subscriptionId: string
  month: string
  short: string
  confirmed: boolean
  partnerPaid: boolean
  skipped: boolean
  isShared: boolean
  transactionId: string | null
  ownerPaid: boolean
  ownerPaidByName: string | null
  partnerPaidByName: string | null
}

export const db = new TandemDB()

/** Borra todos los datos locales (logout / cambio de usuario). */
export async function clearLocalData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.meta,
      db.accounts,
      db.transactions,
      db.shares,
      db.debtPayments,
      db.lineSums,
      db.categories,
      db.subscriptions,
      db.charges,
      db.partnerDebts,
      db.cardPay,
      db.partnerShared,
      db.groups,
      db.budgets,
      db.budgetItems,
      db.budgetLimits,
      db.outbox,
    ],
    async () => {
      await Promise.all([
        db.meta.clear(),
        db.accounts.clear(),
        db.transactions.clear(),
        db.shares.clear(),
        db.debtPayments.clear(),
        db.lineSums.clear(),
        db.categories.clear(),
        db.subscriptions.clear(),
        db.charges.clear(),
        db.partnerDebts.clear(),
        db.cardPay.clear(),
        db.partnerShared.clear(),
        db.groups.clear(),
        db.budgets.clear(),
        db.budgetItems.clear(),
        db.budgetLimits.clear(),
        db.outbox.clear(),
      ])
    },
  )
}
