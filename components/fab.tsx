'use client'

import { useState } from 'react'

import { useLiveQuery } from 'dexie-react-hooks'
import { Landmark, Plus, Repeat, UserPlus, Users } from 'lucide-react'
import { usePathname } from 'next/navigation'

import { AccountForm } from '@/components/account-form'
import { BottomSheet } from '@/components/bottom-sheet'
import { GroupCreateSheet, GroupJoinSheet } from '@/components/group-sheets'
import { SubscriptionForm } from '@/components/subscription-form'
import { type AccountOpt, TransactionForm } from '@/components/transaction-form'

import { byAccountOrder, toAccountOpt } from '@/lib/accounts'
import type { CatalogRow } from '@/lib/catalog'
import { useCuentasFilters } from '@/lib/cuentas-filters'
import { db } from '@/lib/offline/db'
import { toCatalog } from '@/lib/offline/derive-activity'
import { cn } from '@/lib/utils'

const FAB_CLS =
  'fixed right-5 bottom-24 z-40 flex size-14 items-center justify-center rounded-full bg-(--primary) text-(--primary-foreground) shadow-2xl transition active:scale-95'

type FabProps = {
  accountOptions: AccountOpt[]
  cats: CatalogRow[]
}

export function Fab({ accountOptions, cats }: FabProps) {
  const pathname = usePathname()

  // Resumen, Ajustes, Categorías y Grupos: sin botón flotante
  // (el detalle del grupo trae su propio + Gasto grupal).
  if (
    pathname.startsWith('/resumen') ||
    pathname.startsWith('/ajustes') ||
    pathname.startsWith('/categorias') ||
    pathname.startsWith('/grupos')
  )
    return null

  // Cuentas: speed-dial con dos acciones (cuenta / suscripción).
  // `key` por ruta: al navegar y volver, el menú se remonta y arranca cerrado.
  if (pathname.startsWith('/cuentas')) {
    return (
      <CuentasSpeedDial
        key={pathname}
        accountOptions={accountOptions}
        cats={cats}
      />
    )
  }

  // Actividad (y resto): drawer de movimiento.
  return <TxFab accountOptions={accountOptions} cats={cats} />
}

function CuentasSpeedDial({ accountOptions, cats }: FabProps) {
  const [expanded, setExpanded] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [subOpen, setSubOpen] = useState(false)
  const [groupCreateOpen, setGroupCreateOpen] = useState(false)
  const [groupJoinOpen, setGroupJoinOpen] = useState(false)
  // Dialer contextual: en Compartidos ofrece Nuevo/Unirse a grupo (oculta
  // Cuenta/Suscripción); en el resto, Cuenta/Suscripción como siempre.
  const tab = useCuentasFilters((s) => s.tab)
  const sharedTab = tab === 'compartidos'
  // NOTA: el menú NO usa useBackToClose a propósito. Si empujara su propia
  // entrada al historial, al abrir Cuenta/Suscripción en el mismo tap la
  // limpieza del menú se comería la entrada del modal (race) y el botón
  // atrás del teléfono dejaría de cerrar esos modales. El menú se cierra
  // tocando el backdrop. Cada BottomSheet sí captura atrás con su entrada.

  return (
    <>
      <button
        aria-hidden
        tabIndex={-1}
        onClick={() => setExpanded(false)}
        className={cn(
          'fixed inset-0 z-40 cursor-default bg-black/40 backdrop-blur-sm transition-opacity duration-200',
          expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <div className="pointer-events-none fixed right-5 bottom-24 z-50 flex flex-col items-end gap-3">
        <div
          aria-hidden={!expanded}
          className={cn(
            'absolute right-0 bottom-[68px] flex flex-col items-end gap-3 transition-all duration-200',
            expanded
              ? 'pointer-events-auto visible translate-y-0 opacity-100'
              : 'pointer-events-none invisible translate-y-2 opacity-0',
          )}>
          {sharedTab ? (
            <>
              <button
                onClick={() => {
                  setExpanded(false)
                  setGroupCreateOpen(true)
                }}
                aria-label="Crear grupo"
                className="flex cursor-pointer items-center justify-end gap-2">
                <span className="rounded-full border border-(--border) bg-(--card) px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap shadow-lg">
                  Nuevo grupo
                </span>
                <span className="mr-1 flex size-12 items-center justify-center rounded-full border border-(--border) bg-(--card) shadow-xl transition active:scale-95">
                  <Users className="size-5" />
                </span>
              </button>
              <button
                onClick={() => {
                  setExpanded(false)
                  setGroupJoinOpen(true)
                }}
                aria-label="Unirse a grupo"
                className="flex cursor-pointer items-center justify-end gap-2">
                <span className="rounded-full border border-(--border) bg-(--card) px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap shadow-lg">
                  Unirse
                </span>
                <span className="mr-1 flex size-12 items-center justify-center rounded-full border border-(--border) bg-(--card) shadow-xl transition active:scale-95">
                  <UserPlus className="size-5" />
                </span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setExpanded(false)
                  setAccountOpen(true)
                }}
                aria-label="Añadir cuenta"
                className="flex cursor-pointer items-center justify-end gap-2">
                <span className="rounded-full border border-(--border) bg-(--card) px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap shadow-lg">
                  Cuenta
                </span>
                <span className="mr-1 flex size-12 items-center justify-center rounded-full border border-(--border) bg-(--card) shadow-xl transition active:scale-95">
                  <Landmark className="size-5" />
                </span>
              </button>
              <button
                onClick={() => {
                  setExpanded(false)
                  setSubOpen(true)
                }}
                aria-label="Añadir suscripción"
                className="flex cursor-pointer items-center justify-end gap-2">
                <span className="rounded-full border border-(--border) bg-(--card) px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap shadow-lg">
                  Suscripción
                </span>
                <span className="mr-1 flex size-12 items-center justify-center rounded-full border border-(--border) bg-(--card) shadow-xl transition active:scale-95">
                  <Repeat className="size-5" />
                </span>
              </button>
            </>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-label={
            expanded
              ? 'Cerrar opciones'
              : sharedTab
                ? 'Crear o unirte a un grupo'
                : 'Agregar cuenta o suscripción'
          }
          aria-expanded={expanded}
          className={cn(
            FAB_CLS,
            'pointer-events-auto relative right-auto bottom-auto',
          )}>
          <Plus
            className={cn(
              'size-7 transition-transform duration-200',
              expanded && 'rotate-45',
            )}
          />
        </button>
      </div>
      <BottomSheet open={accountOpen} onOpenChange={setAccountOpen}>
        <AccountForm onDone={() => setAccountOpen(false)} />
      </BottomSheet>
      <BottomSheet open={subOpen} onOpenChange={setSubOpen}>
        <SubscriptionForm
          accountOptions={accountOptions}
          cats={cats}
          onDone={() => setSubOpen(false)}
        />
      </BottomSheet>
      <BottomSheet open={groupCreateOpen} onOpenChange={setGroupCreateOpen}>
        <GroupCreateSheet onDone={() => setGroupCreateOpen(false)} />
      </BottomSheet>
      <BottomSheet open={groupJoinOpen} onOpenChange={setGroupJoinOpen}>
        <GroupJoinSheet onDone={() => setGroupJoinOpen(false)} />
      </BottomSheet>
    </>
  )
}

function TxFab({ accountOptions, cats }: FabProps) {
  const [open, setOpen] = useState(false)
  // Dexie-first (coherente con los shells): con copia local, cuentas y
  // catálogo salen de IndexedDB y el form funciona sin conexión. Los props
  // del servidor quedan como fallback de primera carga.
  const local = useLiveQuery(async () => {
    const [accounts, categories] = await Promise.all([
      db.accounts.toArray(),
      db.categories.toArray(),
    ])
    return { accounts, categories }
  }, [])
  const hasLocal =
    !!local && (local.accounts.length > 0 || local.categories.length > 0)
  const opts: AccountOpt[] = hasLocal
    ? local.accounts
        .filter((a) => !a.isHidden)
        .map(toAccountOpt)
        .sort(byAccountOrder)
    : accountOptions
  const catalog: CatalogRow[] = hasLocal ? toCatalog(local.categories) : cats
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Registrar movimiento"
        className={FAB_CLS}>
        <Plus className="size-7" />
      </button>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <TransactionForm
          accountOptions={opts}
          cats={catalog}
          onDone={() => setOpen(false)}
        />
      </BottomSheet>
    </>
  )
}
