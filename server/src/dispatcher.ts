// Start command for a dedicated outbox dispatcher process:
//   node server/dist/dispatcher.js
// Same as LATTICE_ROLE=dispatcher node server/dist/index.js.
process.env.LATTICE_ROLE = 'dispatcher'
await import('./index.js')
