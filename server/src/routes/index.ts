import { Router } from 'express'
import { configRoutes } from './config.routes.js'
import { aiRoutes } from './ai.routes.js'
import { referenceRoutes } from './reference.routes.js'
import { formsRoutes } from './forms.routes.js'
import { quoteRoutes } from './quotes.routes.js'
import { policyRoutes } from './policies.routes.js'
import { transactionRoutes } from './transactions.routes.js'
import { uwRoutes } from './uw.routes.js'
import { productsRoutes } from './products.routes.js'
import { adminRoutes } from './admin.routes.js'
import { ratingRoutes } from './rating-workbench.routes.js'
import { customerPortalRoutes } from './customer-portal.routes.js'
import { interestsRoutes } from './interests.routes.js'

export const routes = Router()

routes.use('/', configRoutes)
routes.use('/', aiRoutes)
routes.use('/', referenceRoutes)
routes.use('/', formsRoutes)
routes.use('/', quoteRoutes)
routes.use('/', policyRoutes)
routes.use('/', transactionRoutes)
routes.use('/', uwRoutes)
routes.use('/', productsRoutes)
routes.use('/admin', adminRoutes)
routes.use('/rating', ratingRoutes)
routes.use('/customer-portal', customerPortalRoutes)
routes.use('/policies/:id/interests', interestsRoutes)
