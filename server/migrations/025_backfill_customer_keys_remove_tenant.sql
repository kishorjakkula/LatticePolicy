BEGIN;

ALTER TABLE tenants
  ALTER COLUMN customer_key_pattern SET DEFAULT 'CUST-{YYYY}-{SEQ6}';

UPDATE tenants
   SET customer_key_pattern = btrim(
     regexp_replace(
       regexp_replace(
         regexp_replace(coalesce(customer_key_pattern, ''), '\{TENANT\}', '', 'gi'),
         '-{2,}',
         '-',
         'g'
       ),
       '(^-+)|(-+$)',
       '',
       'g'
     )
   )
 WHERE coalesce(customer_key_pattern, '') ~* '\{TENANT\}';

UPDATE tenants
   SET customer_key_pattern = 'CUST-{YYYY}-{SEQ6}'
 WHERE coalesce(btrim(customer_key_pattern), '') = '';

CREATE TEMP TABLE tmp_customer_key_remap (
  tenant_id text NOT NULL,
  customer_id uuid NOT NULL,
  old_key text NOT NULL,
  new_key text NOT NULL,
  PRIMARY KEY (tenant_id, customer_id)
) ON COMMIT DROP;

DO $$
DECLARE
  rec record;
  desired_key text;
  final_key text;
  next_seq int;
  seq_width int;
BEGIN
  FOR rec IN
    SELECT
      c.tenant_id,
      c.customer_id,
      c.customer_key AS old_key,
      (regexp_match(c.customer_key, '^CUST-[^-]+-([0-9]{4})-([0-9]{1,8})$'))[1] AS key_year,
      (regexp_match(c.customer_key, '^CUST-[^-]+-([0-9]{4})-([0-9]{1,8})$'))[2] AS key_seq,
      c.created_at
    FROM customers c
    WHERE c.customer_key ~ '^CUST-[^-]+-[0-9]{4}-[0-9]{1,8}$'
    ORDER BY c.tenant_id, c.created_at, c.customer_id
  LOOP
    seq_width := GREATEST(6, length(rec.key_seq));
    desired_key := format('CUST-%s-%s', rec.key_year, lpad(rec.key_seq, seq_width, '0'));
    final_key := desired_key;

    IF EXISTS (
      SELECT 1
      FROM customers c
      WHERE c.tenant_id = rec.tenant_id
        AND c.customer_key = final_key
        AND c.customer_id <> rec.customer_id
    ) OR EXISTS (
      SELECT 1
      FROM tmp_customer_key_remap m
      WHERE m.tenant_id = rec.tenant_id
        AND m.new_key = final_key
    ) THEN
      SELECT COALESCE(MAX(src.seq_num), 0)
        INTO next_seq
      FROM (
        SELECT
          ((regexp_match(c.customer_key, format('^CUST-%s-([0-9]{1,8})$', rec.key_year)))[1])::int AS seq_num
        FROM customers c
        WHERE c.tenant_id = rec.tenant_id
          AND c.customer_key ~ format('^CUST-%s-[0-9]{1,8}$', rec.key_year)
        UNION ALL
        SELECT
          ((regexp_match(m.new_key, format('^CUST-%s-([0-9]{1,8})$', rec.key_year)))[1])::int AS seq_num
        FROM tmp_customer_key_remap m
        WHERE m.tenant_id = rec.tenant_id
          AND m.new_key ~ format('^CUST-%s-[0-9]{1,8}$', rec.key_year)
      ) src;

      next_seq := next_seq + 1;
      LOOP
        final_key := format('CUST-%s-%s', rec.key_year, lpad(next_seq::text, 6, '0'));
        EXIT WHEN NOT EXISTS (
          SELECT 1
          FROM customers c
          WHERE c.tenant_id = rec.tenant_id
            AND c.customer_key = final_key
            AND c.customer_id <> rec.customer_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM tmp_customer_key_remap m
          WHERE m.tenant_id = rec.tenant_id
            AND m.new_key = final_key
        );
        next_seq := next_seq + 1;
      END LOOP;
    END IF;

    INSERT INTO tmp_customer_key_remap (tenant_id, customer_id, old_key, new_key)
    VALUES (rec.tenant_id, rec.customer_id, rec.old_key, final_key);
  END LOOP;
END $$;

UPDATE customers c
   SET customer_key = m.new_key,
       updated_at = now()
  FROM tmp_customer_key_remap m
 WHERE c.tenant_id = m.tenant_id
   AND c.customer_id = m.customer_id
   AND c.customer_key <> m.new_key;

UPDATE policy_customer_links pcl
   SET metadata = replace(coalesce(pcl.metadata, '{}'::jsonb)::text, m.old_key, m.new_key)::jsonb,
       updated_at = now()
  FROM tmp_customer_key_remap m
 WHERE pcl.tenant_id = m.tenant_id
   AND pcl.metadata::text LIKE '%' || m.old_key || '%';

UPDATE policies p
   SET metadata = replace(coalesce(p.metadata, '{}'::jsonb)::text, m.old_key, m.new_key)::jsonb,
       risk_summary = replace(coalesce(p.risk_summary, '{}'::jsonb)::text, m.old_key, m.new_key)::jsonb,
       updated_at = now()
  FROM tmp_customer_key_remap m
 WHERE p.tenant_id = m.tenant_id
   AND (
     p.metadata::text LIKE '%' || m.old_key || '%'
     OR p.risk_summary::text LIKE '%' || m.old_key || '%'
   );

UPDATE quotes q
   SET payload = replace(coalesce(q.payload, '{}'::jsonb)::text, m.old_key, m.new_key)::jsonb,
       updated_at = now()
  FROM tmp_customer_key_remap m
 WHERE q.tenant_id = m.tenant_id
   AND q.payload::text LIKE '%' || m.old_key || '%';

UPDATE policy_transactions pt
   SET snapshot = replace(coalesce(pt.snapshot, '{}'::jsonb)::text, m.old_key, m.new_key)::jsonb,
       metadata = replace(coalesce(pt.metadata, '{}'::jsonb)::text, m.old_key, m.new_key)::jsonb,
       updated_at = now()
  FROM tmp_customer_key_remap m
 WHERE pt.tenant_id = m.tenant_id
   AND (
     pt.snapshot::text LIKE '%' || m.old_key || '%'
     OR pt.metadata::text LIKE '%' || m.old_key || '%'
   );

UPDATE policy_versions pv
   SET payload = replace(coalesce(pv.payload, '{}'::jsonb)::text, m.old_key, m.new_key)::jsonb
  FROM tmp_customer_key_remap m
 WHERE pv.tenant_id = m.tenant_id
   AND pv.payload::text LIKE '%' || m.old_key || '%';

WITH parsed AS (
  SELECT
    c.tenant_id,
    ((regexp_match(c.customer_key, '^CUST-([0-9]{4})-([0-9]{1,8})$'))[1])::int AS sequence_year,
    ((regexp_match(c.customer_key, '^CUST-([0-9]{4})-([0-9]{1,8})$'))[2])::int AS seq_value
  FROM customers c
  WHERE c.customer_key ~ '^CUST-[0-9]{4}-[0-9]{1,8}$'
),
maxes AS (
  SELECT tenant_id, sequence_year, MAX(seq_value)::int AS max_value
  FROM parsed
  GROUP BY tenant_id, sequence_year
)
INSERT INTO customer_key_sequences (tenant_id, sequence_year, last_value, updated_at)
SELECT tenant_id, sequence_year, max_value, now()
FROM maxes
ON CONFLICT (tenant_id, sequence_year)
DO UPDATE
   SET last_value = GREATEST(customer_key_sequences.last_value, EXCLUDED.last_value),
       updated_at = now();

COMMIT;
