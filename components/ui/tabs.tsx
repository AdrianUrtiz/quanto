'use client'

import * as React from 'react'

import * as TabsPrimitive from '@radix-ui/react-tabs'

import { cn } from '@/lib/utils'

export function Tabs(props: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root {...props} />
}
export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'no-scrollbar inline-flex w-full items-center justify-center gap-1 overflow-x-auto rounded-2xl bg-(--muted) p-1',
        className,
      )}
      {...props}
    />
  )
}
export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'flex-1 shrink-0 rounded-xl px-3 py-2 text-sm font-semibold whitespace-nowrap text-(--muted-foreground) transition data-[state=active]:bg-(--card) data-[state=active]:text-(--foreground) data-[state=active]:shadow',
        className,
      )}
      {...props}
    />
  )
}
export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('mt-4', className)} {...props} />
}
