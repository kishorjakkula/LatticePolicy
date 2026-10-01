import { closeDb, initDb } from './db.js'

try {
  await initDb()
} finally {
  await closeDb()
}
