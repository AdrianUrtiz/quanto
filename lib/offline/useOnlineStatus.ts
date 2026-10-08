'use client'

import { useSyncExternalStore } from 'react'

function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

function getSnapshot() {
  return navigator.onLine
}

function getServerSnapshot() {
  // En SSR se asume en línea: el badge no se renderiza y no hay flash
  // en hidratación (el cliente corrige en el primer pintado si está offline).
  return true
}

/** Estado de red (fuente única para badge y selección de origen de datos). */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
