'use client'

import { ArrowLeftRight } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { TxRow } from '@/components/transaction-list'

import type { CatalogRow } from '@/lib/catalog'
import { lookupCategory } from '@/lib/categories'
import { formatMoney } from '@/lib/utils'

function fmtFull(d: string): string {
  const dt = new Date(d)
  const fecha = new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt)
  const hora = new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(dt)
  const cap = fecha.charAt(0).toUpperCase() + fecha.slice(1)
  return hora !== '00:00' ? `${cap} · ${hora}` : cap
}

function typeLabel(t: TxRow): string {
  if (t.type === 'INCOME') return 'Ingreso'
  if (t.type === 'TRANSFER') return 'Traspaso'
  return 'Gasto'
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="shrink-0 text-xs font-medium text-(--muted-foreground)">
        {label}
      </span>
      <span className="text-right text-sm font-semibold">{value}</span>
    </div>
  )
}

/** Contenido del detalle de un movimiento (se monta dentro de un BottomSheet). */
export function TransactionDetail({
  t,
  cats,
}: {
  t: TxRow
  cats: CatalogRow[]
}) {
  const income = t.type === 'INCOME'
  const transfer = t.type === 'TRANSFER'
  const cat = lookupCategory(t.category, cats)
  const CatIcon = cat.icon
  const sign = transfer ? '' : income ? '+' : '−'

  return (
    <div className="overflow-y-auto px-5 pt-1 pb-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <span
          className="flex size-14 items-center justify-center rounded-3xl"
          style={
            transfer
              ? undefined
              : { backgroundColor: `${cat.color}22`, color: cat.color }
          }>
          {transfer ? (
            <ArrowLeftRight className="size-6 text-(--primary)" />
          ) : (
            <CatIcon className="size-6" />
          )}
        </span>
        <p className="text-lg font-extrabold tracking-tight">{t.concept}</p>
        <p
          className={`text-3xl font-extrabold tracking-tight ${income ? 'text-emerald-500' : ''}`}>
          {sign}
          {formatMoney(t.amount)}
        </p>
        <p className="text-xs font-medium text-(--muted-foreground)">
          {fmtFull(t.date)}
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          {t.pendingSync && <Badge variant="warning">Pendiente de subir</Badge>}
          {t.installments > 1 && (
            <Badge variant="warning">{t.installments} MSI</Badge>
          )}
          {t.isShared && <Badge>Compartido</Badge>}
          {transfer && (
            <Badge variant="secondary">
              {t.transferToAccountType === 'CREDIT'
                ? 'Pago tarjeta'
                : 'Transferencia'}
            </Badge>
          )}
          {t.partnerShare && <Badge variant="secondary">Solo lectura</Badge>}
          {t.locked && !t.partnerShare && (
            <Badge variant="secondary">Pago confirmado</Badge>
          )}
        </div>
      </div>

      <div className="mt-4 divide-y divide-(--border) rounded-3xl border border-(--border) bg-(--muted)/40 px-4">
        <Row label="Tipo" value={typeLabel(t)} />
        {!transfer && <Row label="Categoría" value={cat.label} />}
        {transfer && t.transferToAccountName ? (
          <Row
            label="Cuentas"
            value={`${t.accountName} → ${t.transferToAccountName}`}
          />
        ) : t.accountName ? (
          <Row label="Cuenta" value={t.accountName} />
        ) : null}
        {t.installments > 1 && (
          <Row label="Parcialidades" value={`${t.installments} meses`} />
        )}
        {t.isShared && !t.partnerShare && t.shareMonthly != null && (
          <Row
            label="Reparto"
            value={
              t.shareFixed
                ? `${formatMoney(t.shareMonthly)} fijos al mes`
                : `${t.sharePct ?? ''}% · ${formatMoney(t.shareMonthly)}/mes`
            }
          />
        )}
        {t.shareExternalName && (
          <Row label="Compartido con" value={t.shareExternalName} />
        )}
        {t.isGroup && (
          <Row
            label="Grupo"
            value={
              t.accountName
                ? 'Gasto grupal con cuenta vinculada'
                : 'Gasto grupal sin cuenta vinculada'
            }
          />
        )}
        {t.partnerShare ? (
          <Row
            label="Origen"
            value={`Compartido por ${t.creatorName} · mi parte`}
          />
        ) : (
          <Row label="Registrado por" value={t.creatorName} />
        )}
      </div>
    </div>
  )
}
