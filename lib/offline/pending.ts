// Ids temporales de movimientos creados offline (puros, sin Dexie).
//
// Este módulo NO importa Dexie para poder usarse desde código compartido
// servidor/cliente (`calculations.ts`, `statements.ts`, derives y UI).
// Convención: todo id que empiece con `temp-` es un eco local pendiente
// de subir; los ids del servidor (cuid/uuid) nunca llevan ese prefijo.
export const TEMP_ID_PREFIX = 'temp-'

export function isPendingId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(TEMP_ID_PREFIX)
}

export function newTempTxId(): string {
  return `${TEMP_ID_PREFIX}${crypto.randomUUID()}`
}

export function newTempShareId(): string {
  return `${TEMP_ID_PREFIX}s-${crypto.randomUUID()}`
}
