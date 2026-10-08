'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker una sola vez al montar. Se hace aquí (y no
 * con next/script) para garantizar que el registro realmente se ejecuta
 * en el cliente, también tras hidratación.
 */
export function SwRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Sin SW: la app funciona online; el modo offline no disponible.
      })
    }
    // En desarrollo con HMR el evento load ya pudo ocurrir.
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
    return () => window.removeEventListener('load', register)
  }, [])

  return null
}
