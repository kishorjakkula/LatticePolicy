// Start command for a dedicated batch-job process:
//   node server/dist/worker.js
// Same as LATTICE_ROLE=worker node server/dist/index.js.
process.env.LATTICE_ROLE = 'worker'
await import('./index.js')
