-- Every shop sells at retail and wholesale prices: businesses that never had a
-- second price list get a Wholesale one (restaurants keep a single price).
-- Items without a wholesale price sell at their retail price on it.
INSERT INTO "price_lists" ("id", "tenant_id", "name", "currency_code", "is_default", "active")
SELECT gen_random_uuid(), t."id", 'Wholesale', t."base_currency", false, true
FROM "tenants" t
WHERE t."business_type" <> 'restaurant'
  AND NOT EXISTS (SELECT 1 FROM "price_lists" p WHERE p."tenant_id" = t."id" AND NOT p."is_default");
