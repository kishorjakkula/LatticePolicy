import type { RequestHandler, Router } from 'express'

type MountedRouter = { prefix: string; router: Router }
type RouteLayer = {
  route?: { path?: string | string[]; methods?: Record<string, boolean> }
  handle?: RequestHandler & { stack?: unknown[] }
}

const mountedRouters = new WeakMap<Router, MountedRouter[]>()

export function mountRouter(parent: Router, prefix: string, ...handlers: RequestHandler[]) {
  parent.use(prefix, ...handlers)
  const child = [...handlers].reverse().find((handler) => Array.isArray((handler as any)?.stack)) as Router | undefined
  if (!child) throw new Error(`Mounted route ${prefix} does not include an Express router`)
  const mounts = mountedRouters.get(parent) || []
  mounts.push({ prefix, router: child })
  mountedRouters.set(parent, mounts)
}

function joinPath(base: string, path: string): string {
  const joined = `${base}/${path}`.replace(/\/+/g, '/')
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined
}

function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

export type RegisteredRoute = {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete'
  path: string
}

export function collectRegisteredRoutes(router: Router, basePath = ''): RegisteredRoute[] {
  const routes: RegisteredRoute[] = []
  for (const layer of ((router as any).stack || []) as RouteLayer[]) {
    if (!layer.route?.path || !layer.route.methods) continue
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]
    for (const path of paths) {
      for (const method of ['get', 'post', 'patch', 'put', 'delete'] as const) {
        if (layer.route.methods[method]) routes.push({ method, path: openApiPath(joinPath(basePath, path)) })
      }
    }
  }
  for (const mount of mountedRouters.get(router) || []) {
    routes.push(...collectRegisteredRoutes(mount.router, joinPath(basePath, mount.prefix)))
  }
  return routes
}

export function countUnregisteredMountedRouters(router: Router): number {
  const mounts = mountedRouters.get(router) || []
  const registeredChildren = new Set(mounts.map((mount) => mount.router))
  const unregistered = (((router as any).stack || []) as RouteLayer[])
    .filter((layer) => Array.isArray(layer.handle?.stack) && !registeredChildren.has(layer.handle as Router))
    .length
  return unregistered + mounts.reduce(
    (count, mount) => count + countUnregisteredMountedRouters(mount.router),
    0,
  )
}
