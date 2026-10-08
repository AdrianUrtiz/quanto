'use client'

import { SessionProvider } from 'next-auth/react'

import { AutoSync } from '@/components/auto-sync'
import { OfflineBadge } from '@/components/offline-badge'
import { SonnerProvider } from '@/components/sonner-provider'
import { SwRegister } from '@/components/sw-register'
import { ThemeProvider } from '@/components/theme-provider'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider defaultTheme="dark">
        {children}
        <OfflineBadge />
        <AutoSync />
        <SwRegister />
        <SonnerProvider />
      </ThemeProvider>
    </SessionProvider>
  )
}
