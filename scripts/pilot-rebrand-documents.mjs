// One-off conversion of pre-branding synthetic pilot examples. Never called by setup.
import { execFileSync } from 'node:child_process'
import { profile } from './pilot-lib.mjs'
if (profile.tenantId !== 'acme-pilot' || profile.name !== 'Acme Mutual Pilot') throw new Error('Synthetic pilot only')
const container = execFileSync('docker', ['compose', '--env-file', '.pilot/kit/carrier.env', '-f', '.pilot/kit/docker-compose.yml', '-p', 'lattice-acme-pilot', 'ps', '-q', 'api'], { encoding: 'utf8' }).trim()
if (!container) throw new Error('Pilot API is not running')
const script = `
import { initDb, closeDb, withTenantTx, toRawQuery } from './server/dist/db.js';
import { loadCarrierBranding } from './server/dist/services/carrier-branding.service.js';
import { renderAndStoreDocument, storeRatingWorksheet, retrieveAndVerifyStoredDocument, closePdfRenderer } from './server/dist/services/document-storage.service.js';
if (process.env.CARRIER_TENANT_ID !== 'acme-pilot') throw new Error('Synthetic pilot only');
await initDb();
try {
 const tenantId = 'acme-pilot';
 const branding = await loadCarrierBranding(tenantId);
 let converted = 0;
 await withTenantTx(tenantId, async db => {
  const q = toRawQuery(db);
  const result = await q("SELECT document_id, type, hash, metadata FROM documents WHERE tenant_id=$1 AND type IN ('POLICY_PACKET','RATING_WORKSHEET') FOR UPDATE", [tenantId]);
  for (const row of result.rows) {
   const metadata = row.metadata || {};
   if (metadata.branding) continue;
   const original = metadata.artifact;
   if (!original?.storageUri || !await retrieveAndVerifyStoredDocument(original.storageUri, row.hash)) throw new Error('Original artifact verification failed');
   // Store a separate branded copy; the original path and original bytes are untouched.
   const newMetadata = { ...metadata, branding, brandingRevisions: [...(metadata.brandingRevisions || []), { changedAt: new Date().toISOString(), reason: 'Synthetic pilot carrier branding', originalHash: row.hash, originalArtifact: original }] };
   const params = { tenantId, documentId: row.document_id + '-carrier-branded', metadata: newMetadata };
   const artifact = row.type === 'POLICY_PACKET' ? await renderAndStoreDocument(params) : await storeRatingWorksheet(params);
   if (!await retrieveAndVerifyStoredDocument(artifact.storageUri, artifact.contentHash)) throw new Error('Branded copy verification failed');
   newMetadata.artifact = artifact;
   await q("UPDATE documents SET metadata=$3::jsonb, hash=$4, integrity_status='VERIFIED' WHERE tenant_id=$1 AND document_id=$2 AND hash=$5", [tenantId, row.document_id, JSON.stringify(newMetadata), artifact.contentHash, row.hash]);
   converted++;
  }
 });
 console.log(JSON.stringify({ tenantId, converted, originalsPreserved: true }));
} finally { await closePdfRenderer(); await closeDb(); }
`
execFileSync('docker', ['exec', '-i', container, 'node', '--input-type=module'], { input: script, stdio: ['pipe', 'inherit', 'inherit'] })
