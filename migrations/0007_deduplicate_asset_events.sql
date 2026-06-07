WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY symbol, source, source_document_id
      ORDER BY
        CASE WHEN event_type <> 'other' THEN 0 ELSE 1 END,
        CASE WHEN raw_text IS NOT NULL AND raw_text <> '' THEN 0 ELSE 1 END,
        updated_at DESC,
        id DESC
    ) AS position
  FROM market_data_asset_events
  WHERE source IS NOT NULL
    AND source_document_id IS NOT NULL
    AND source_document_id <> ''
)
DELETE FROM market_data_asset_events target
USING ranked
WHERE target.id = ranked.id
  AND ranked.position > 1;

UPDATE market_data_asset_events
SET dedup_key = source || ':' || source_document_id,
    updated_at = NOW()
WHERE source IS NOT NULL
  AND source_document_id IS NOT NULL
  AND source_document_id <> '';
