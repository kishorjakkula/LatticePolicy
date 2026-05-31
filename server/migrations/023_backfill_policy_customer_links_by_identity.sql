BEGIN;

WITH latest_versions AS (
  SELECT DISTINCT ON (pv.tenant_id, pv.policy_id)
    pv.tenant_id,
    pv.policy_id,
    coalesce(pv.payload, '{}'::jsonb) AS payload
  FROM policy_versions pv
  ORDER BY pv.tenant_id, pv.policy_id, pv.processed_at DESC NULLS LAST, pv.version_id DESC
),
primary_payload AS (
  SELECT
    lv.tenant_id,
    lv.policy_id,
    lower(trim(coalesce(lv.payload #>> '{insureds,primary,email}', ''))) AS email,
    trim(coalesce(lv.payload #>> '{insureds,primary,firstName}', '')) AS first_name,
    trim(coalesce(lv.payload #>> '{insureds,primary,lastName}', '')) AS last_name,
    trim(coalesce(lv.payload #>> '{insureds,primary,displayName}', '')) AS display_name
  FROM latest_versions lv
),
unlinked_primary AS (
  SELECT pp.*
  FROM primary_payload pp
  LEFT JOIN policy_customer_links pcl
    ON pcl.tenant_id = pp.tenant_id
   AND pcl.policy_id = pp.policy_id
   AND pcl.role_code = 'PRIMARY_NAMED_INSURED'
   AND pcl.is_primary = true
  WHERE pcl.policy_id IS NULL
),
email_match AS (
  SELECT
    up.tenant_id,
    up.policy_id,
    count(DISTINCT cp.customer_id)::int AS match_count,
    min(cp.customer_id::text)::uuid AS customer_id
  FROM unlinked_primary up
  JOIN customer_contact_points cp
    ON cp.tenant_id = up.tenant_id
   AND cp.contact_type = 'EMAIL'
   AND cp.effective_to IS NULL
   AND cp.normalized_value = up.email
  WHERE up.email <> ''
  GROUP BY up.tenant_id, up.policy_id
),
name_match AS (
  SELECT
    up.tenant_id,
    up.policy_id,
    count(DISTINCT c.customer_id)::int AS match_count,
    min(c.customer_id::text)::uuid AS customer_id
  FROM unlinked_primary up
  JOIN customer_person_details pd
    ON pd.tenant_id = up.tenant_id
   AND lower(trim(coalesce(pd.first_name, ''))) = lower(up.first_name)
   AND lower(trim(coalesce(pd.last_name, ''))) = lower(up.last_name)
  JOIN customers c
    ON c.tenant_id = pd.tenant_id
   AND c.customer_id = pd.customer_id
  WHERE up.first_name <> ''
    AND up.last_name <> ''
  GROUP BY up.tenant_id, up.policy_id
),
resolved_primary AS (
  SELECT
    up.tenant_id,
    up.policy_id,
    CASE
      WHEN em.match_count = 1 THEN em.customer_id
      WHEN coalesce(em.match_count, 0) = 0 AND nm.match_count = 1 THEN nm.customer_id
      ELSE NULL
    END AS customer_id,
    up.display_name
  FROM unlinked_primary up
  LEFT JOIN email_match em
    ON em.tenant_id = up.tenant_id
   AND em.policy_id = up.policy_id
  LEFT JOIN name_match nm
    ON nm.tenant_id = up.tenant_id
   AND nm.policy_id = up.policy_id
),
resolved_valid AS (
  SELECT
    rp.tenant_id,
    rp.policy_id,
    rp.customer_id,
    c.customer_key,
    nullif(trim(coalesce(rp.display_name, c.display_name, '')), '') AS display_name
  FROM resolved_primary rp
  JOIN customers c
    ON c.tenant_id = rp.tenant_id
   AND c.customer_id = rp.customer_id
  WHERE rp.customer_id IS NOT NULL
)
INSERT INTO policy_customer_links (
  policy_customer_link_id,
  tenant_id,
  policy_id,
  customer_id,
  role_code,
  is_primary,
  source,
  metadata,
  created_at,
  updated_at
)
SELECT
  uuid_generate_v4(),
  rv.tenant_id,
  rv.policy_id,
  rv.customer_id,
  'PRIMARY_NAMED_INSURED',
  true,
  'backfill_identity',
  jsonb_strip_nulls(
    jsonb_build_object(
      'customerKey', rv.customer_key,
      'displayName', rv.display_name
    )
  ),
  now(),
  now()
FROM resolved_valid rv
ON CONFLICT (tenant_id, policy_id, customer_id, role_code)
DO UPDATE SET
  is_primary = EXCLUDED.is_primary,
  source = EXCLUDED.source,
  metadata = EXCLUDED.metadata,
  updated_at = now();

WITH primary_links AS (
  SELECT
    pcl.tenant_id,
    pcl.policy_id,
    pcl.customer_id::text AS customer_id_text,
    nullif(trim(coalesce(pcl.metadata ->> 'customerKey', '')), '') AS customer_key,
    nullif(trim(coalesce(pcl.metadata ->> 'displayName', '')), '') AS customer_name
  FROM policy_customer_links pcl
  WHERE pcl.role_code = 'PRIMARY_NAMED_INSURED'
    AND pcl.is_primary = true
)
UPDATE policies p
SET metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_strip_nulls(
  jsonb_build_object(
    'customerId', pl.customer_id_text,
    'customerKey', pl.customer_key,
    'customerName', pl.customer_name
  )
),
updated_at = now()
FROM primary_links pl
WHERE p.tenant_id = pl.tenant_id
  AND p.policy_id = pl.policy_id;

COMMIT;
