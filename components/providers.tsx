'use client'

import { SessionProvider } from 'next-auth/react'

import { SonnerProvider } from '@/components/sonner-provider'
import { ThemeProvider } from '@/components/theme-provider'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider defaultTheme="dark">
        {children}
        <SonnerProvider />
      </ThemeProvider>
    </SessionProvider>
  )
}
