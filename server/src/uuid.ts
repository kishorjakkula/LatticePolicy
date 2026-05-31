export function v4(): string {
  // Node 18+ has crypto.randomUUID
  // @ts-ignore
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    // @ts-ignore
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

