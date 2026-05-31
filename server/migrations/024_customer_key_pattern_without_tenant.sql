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

COMMIT;
