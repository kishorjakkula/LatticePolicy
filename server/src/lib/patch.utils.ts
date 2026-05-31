/**
 * JSON-patch / deep-diff utility functions extracted from routes.ts.
 * No external runtime dependencies.
 */

/**
 * Return a list of JSON-pointer paths where objects `a` and `b` differ.
 * Only recurses into plain objects (not arrays).
 */
export function diffPayloadPaths(a: any, b: any, base: string = ''): string[] {
  const changes: string[] = []
  const isObj = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      const pa = a[k]
      const pb = b[k]
      const p = base + '/' + k
      if (isObj(pa) || isObj(pb)) {
        changes.push(...diffPayloadPaths(pa ?? {}, pb ?? {}, p))
      } else if (JSON.stringify(pa) !== JSON.stringify(pb)) {
        changes.push(p)
      }
    }
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    changes.push(base || '/')
  }
  return changes
}

/**
 * Read a value from `obj` at a JSON-pointer `path` (e.g. "/foo/bar").
 */
export function getByPath(obj: any, path: string): any {
  if (!path || path === '/') return obj
  const parts = path.split('/').slice(1).map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))
  let cur = obj
  for (const p of parts) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}

export type PatchOp = { path: string; op: 'add' | 'replace' | 'remove'; value?: any }

/**
 * Apply a minimal subset of RFC 6902 JSON Patch operations (add, replace, remove)
 * to `obj` in-place and return it.
 */
export function applyJsonPatch(obj: any, ops: PatchOp[]): any {
  for (const op of ops) {
    const path = op.path || ''
    const parts = path.split('/').slice(1).map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    let target = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]
      if (!(key in target) || typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {}
      }
      target = target[key]
    }
    const last = parts[parts.length - 1]
    if (op.op === 'remove') {
      if (last in target) delete target[last]
    } else if (op.op === 'add' || op.op === 'replace') {
      target[last] = op.value
    }
  }
  return obj
}
