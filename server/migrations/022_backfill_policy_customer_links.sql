BEGIN;

WITH metadata_candidates AS (
  SELECT
    p.tenant_id,
    p.policy_id,
    trim(coalesce(p.metadata ->> 'customerId', '')) AS customer_id_text,
    trim(coalesce(p.metadata ->> 'customerKey', '')) AS customer_key,
    trim(coalesce(p.metadata ->> 'customerName', '')) AS display_name
  FROM policies p
),
metadata_valid AS (
  SELECT
    mc.tenant_id,
    mc.policy_id,
    mc.customer_id_text::uuid AS customer_id,
    mc.customer_key,
    mc.display_name
  FROM metadata_candidates mc
  JOIN customers c
    ON c.tenant_id = mc.tenant_id
   AND c.customer_id = mc.customer_id_text::uuid
  WHERE mc.customer_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
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
  mv.tenant_id,
  mv.policy_id,
  mv.customer_id,
  'PRIMARY_NAMED_INSURED',
  true,
  'backfill_metadata',
  jsonb_strip_nulls(
    jsonb_build_object(
      'customerKey', nullif(mv.customer_key, ''),
      'displayName', nullif(mv.display_name, '')
    )
  ),
  now(),
  now()
FROM metadata_valid mv
ON CONFLICT (tenant_id, policy_id, customer_id, role_code)
DO UPDATE SET
  is_primary = EXCLUDED.is_primary,
  source = EXCLUDED.source,
  metadata = EXCLUDED.metadata,
  updated_at = now();

WITH latest_versions AS (
  SELECT DISTINCT ON (pv.tenant_id, pv.policy_id)
    pv.tenant_id,
    pv.policy_id,
    coalesce(pv.payload, '{}'::jsonb) AS payload
  FROM policy_versions pv
  ORDER BY pv.tenant_id, pv.policy_id, pv.processed_at DESC NULLS LAST, pv.version_id DESC
),
payload_candidates AS (
  SELECT
    lv.tenant_id,
    lv.policy_id,
    'PRIMARY_NAMED_INSURED'::text AS role_code,
    true AS is_primary,
    trim(coalesce(lv.payload #>> '{insureds,primary,customerId}', '')) AS customer_id_text,
    trim(coalesce(lv.payload #>> '{insureds,primary,customerKey}', '')) AS customer_key,
    trim(
      coalesce(
        lv.payload #>> '{insureds,primary,displayName}',
        concat_ws(' ', lv.payload #>> '{insureds,primary,firstName}', lv.payload #>> '{insureds,primary,lastName}')
      )
    ) AS display_name
  FROM latest_versions lv
  UNION ALL
  SELECT
    lv.tenant_id,
    lv.policy_id,
    'SECONDARY_NAMED_INSURED'::text AS role_code,
    false AS is_primary,
    trim(coalesce(lv.payload #>> '{insureds,secondary,customerId}', '')) AS customer_id_text,
    trim(coalesce(lv.payload #>> '{insureds,secondary,customerKey}', '')) AS customer_key,
    trim(
      coalesce(
        lv.payload #>> '{insureds,secondary,displayName}',
        concat_ws(' ', lv.payload #>> '{insureds,secondary,firstName}', lv.payload #>> '{insureds,secondary,lastName}')
      )
    ) AS display_name
  FROM latest_versions lv
  UNION ALL
  SELECT
    lv.tenant_id,
    lv.policy_id,
    'ADDITIONAL_NAMED_INSURED'::text AS role_code,
    false AS is_primary,
    trim(coalesce(additional.value ->> 'customerId', '')) AS customer_id_text,
    trim(coalesce(additional.value ->> 'customerKey', '')) AS customer_key,
    trim(
      coalesce(
        additional.value ->> 'displayName',
        concat_ws(' ', additional.value ->> 'firstName', additional.value ->> 'lastName')
      )
    ) AS display_name
  FROM latest_versions lv
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(lv.payload #> '{insureds,additional}') = 'array' THEN lv.payload #> '{insureds,additional}'
      ELSE '[]'::jsonb
    END
  ) AS additional(value)
),
payload_valid AS (
  SELECT
    pc.tenant_id,
    pc.policy_id,
    pc.role_code,
    pc.is_primary,
    pc.customer_id_text::uuid AS customer_id,
    pc.customer_key,
    pc.display_name
  FROM payload_candidates pc
  JOIN customers c
    ON c.tenant_id = pc.tenant_id
   AND c.customer_id = pc.customer_id_text::uuid
  WHERE pc.customer_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
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
  pv.tenant_id,
  pv.policy_id,
  pv.customer_id,
  pv.role_code,
  pv.is_primary,
  'backfill_payload',
  jsonb_strip_nulls(
    jsonb_build_object(
      'customerKey', nullif(pv.customer_key, ''),
      'displayName', nullif(pv.display_name, '')
    )
  ),
  now(),
  now()
FROM payload_valid pv
ON CONFLICT (tenant_id, policy_id, customer_id, role_code)
DO UPDATE SET
  is_primary = EXCLUDED.is_primary,
  source = EXCLUDED.source,
  metadata = EXCLUDED.metadata,
  updated_at = now();

COMMIT;
