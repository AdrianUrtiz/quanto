'use client'

import * as React from 'react'

import * as DialogPrimitive from '@radix-ui/react-dialog'

import { useBackToClose } from '@/lib/use-back-to-close'
import { useKeyboardOffset } from '@/lib/use-keyboard'
import { cn } from '@/lib/utils'

/** Lleva el campo enfocado a zona visible dentro del scroll del sheet. */
function scrollFieldIntoView(
  target: EventTarget | null,
  root: HTMLElement | null,
) {
  if (!(target instanceof HTMLElement) || !root) return
  const tag = target.tagName
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return
  // Espera a que el teclado termine de abrir antes de medir.
  setTimeout(() => {
    const scroller = target.closest('.overflow-y-auto')
    if (scroller && root.contains(scroller)) {
      const r = target.getBoundingClientRect()
      const sr = scroller.getBoundingClientRect()
      scroller.scrollBy({ top: r.top - sr.top - 88, behavior: 'smooth' })
    } else {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, 120)
}

/** Drawer inferior estilo app móvil: entra deslizando desde abajo. */
export function BottomSheet({
  open,
  onOpenChange,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  className?: string
}) {
  useBackToClose(open, () => onOpenChange(false))
  const kb = useKeyboardOffset(open)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{
    startY: number
    deltaY: number
    dragging: boolean
    pointerId: number
  } | null>(null)

  // Limpia el desplazamiento al abrir/cerrar para no arrastrar transform.
  React.useEffect(() => {
    if (open && rootRef.current) {
      rootRef.current.style.transform = ''
      rootRef.current.style.transition = ''
    }
    drag.current = null
  }, [open])

  function endDrag(commit: boolean) {
    const el = rootRef.current
    const d = drag.current
    drag.current = null
    if (!el || !d) return
    if (commit) {
      onOpenChange(false)
      // Se desmonta al cerrar: deja el transform listo para la próxima.
      requestAnimationFrame(() => {
        el.style.transform = ''
        el.style.transition = ''
      })
    } else {
      el.style.transition = 'transform 200ms ease-out'
      el.style.transform = ''
      window.setTimeout(() => {
        el.style.transition = ''
      }, 220)
    }
  }

  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.dragging) return
    drag.current = {
      startY: e.clientY,
      deltaY: 0,
      dragging: true,
      pointerId: e.pointerId,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const el = rootRef.current
    if (el) el.style.transition = 'none'
  }

  function onHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const el = rootRef.current
    if (!d?.dragging || !el || e.pointerId !== d.pointerId) return
    const deltaY = Math.max(0, e.clientY - d.startY)
    d.deltaY = deltaY
    el.style.transform = deltaY > 0 ? `translateY(${deltaY}px)` : ''
  }

  function onHandlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d?.dragging || e.pointerId !== d.pointerId) return
    // Umbral: 120px o 25% de la altura del sheet, lo que sea menor.
    const h = rootRef.current?.getBoundingClientRect().height ?? 0
    const threshold = h > 0 ? Math.min(120, h * 0.25) : 120
    endDrag(d.deltaY > threshold)
  }
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          ref={rootRef}
          onFocusCapture={(e) => scrollFieldIntoView(e.target, rootRef.current)}
          style={
            kb > 0
              ? { bottom: kb, maxHeight: `calc(98dvh - ${kb}px)` }
              : undefined
          }
          className={cn(
            'animate-sheet-up fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-4xl border-x border-t border-(--border) bg-(--card) shadow-2xl transition-[bottom,max-height] duration-200 outline-none',
            className,
          )}>
          <div
            role="separator"
            aria-label="Arrastrar para cerrar"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            className="shrink-0 cursor-grab touch-none px-8 pt-3 pb-2 active:cursor-grabbing">
            <div className="mx-auto h-1 w-10 rounded-full bg-(--border)" />
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
