import { Router } from 'express'
import { configRoutes } from './config.routes.js'
import { aiRoutes } from './ai.routes.js'
import { referenceRoutes } from './reference.routes.js'
import { formsRoutes } from './forms.routes.js'
import { quoteRoutes } from './quotes.routes.js'
import { policyRoutes } from './policies.routes.js'
import { transactionRoutes } from './transactions.routes.js'
import { uwRoutes } from './uw.routes.js'
import { placementRoutes } from './placement.routes.js'
import { productsRoutes } from './products.routes.js'
import { adminRoutes } from './admin.routes.js'
import { ratingRoutes } from './rating-workbench.routes.js'
import { customerPortalRoutes } from './customer-portal.routes.js'
import { interestsRoutes } from './interests.routes.js'
import { mountRouter } from '../route-registry.js'

export const routes = Router()

mountRouter(routes, '/', configRoutes)
mountRouter(routes, '/', aiRoutes)
mountRouter(routes, '/', referenceRoutes)
mountRouter(routes, '/', formsRoutes)
mountRouter(routes, '/', quoteRoutes)
mountRouter(routes, '/', policyRoutes)
mountRouter(routes, '/', transactionRoutes)
mountRouter(routes, '/', uwRoutes)
mountRouter(routes, '/', placementRoutes)
mountRouter(routes, '/', productsRoutes)
mountRouter(routes, '/admin', adminRoutes)
mountRouter(routes, '/rating', ratingRoutes)
mountRouter(routes, '/customer-portal', customerPortalRoutes)
mountRouter(routes, '/policies/:id/interests', interestsRoutes)
