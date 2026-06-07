WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY symbol, source, source_document_id
      ORDER BY
        CASE WHEN income_type = 'dividend' THEN 0 ELSE 1 END,
        updated_at DESC,
        id DESC
    ) AS position
  FROM market_data_asset_income
  WHERE source IS NOT NULL
    AND source_document_id IS NOT NULL
    AND source_document_id <> ''
)
DELETE FROM market_data_asset_income target
USING ranked
WHERE target.id = ranked.id
  AND ranked.position > 1;

UPDATE market_data_asset_income
SET income_type = 'dividend',
    updated_at = NOW()
WHERE source = 'fundosnet_b3'
  AND income_type = 'amortization'
  AND metadata->>'sourceDocumentType' = 'income_announcement';

UPDATE market_data_asset_income
SET dedup_key = source || ':' || source_document_id
WHERE source IS NOT NULL
  AND source_document_id IS NOT NULL
  AND source_document_id <> '';
