CREATE OR REPLACE FUNCTION market_data_infer_document_type(
  input_title text,
  input_metadata jsonb,
  current_type text
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  normalized text;
BEGIN
  normalized := lower(
    coalesce(input_title, '') || ' ' ||
    coalesce(input_metadata->>'type', '') || ' ' ||
    coalesce(input_metadata->>'category', '') || ' ' ||
    coalesce(input_metadata->>'htmlTitle', '')
  );

  normalized := replace(normalized, '&ccedil;', 'ç');
  normalized := replace(normalized, '&otilde;', 'õ');
  normalized := replace(normalized, '&atilde;', 'ã');
  normalized := replace(normalized, '&aacute;', 'á');
  normalized := replace(normalized, '&eacute;', 'é');
  normalized := replace(normalized, '&iacute;', 'í');
  normalized := replace(normalized, '&oacute;', 'ó');
  normalized := replace(normalized, '&uacute;', 'ú');

  IF normalized LIKE '%pagamento de proventos%'
    OR normalized LIKE '%rendimento%'
    OR normalized LIKE '%amortiza%'
  THEN
    RETURN 'income_announcement';
  END IF;

  IF normalized LIKE '%relatório gerencial%'
    OR normalized LIKE '%relatorio gerencial%'
  THEN
    RETURN 'fii_management_report';
  END IF;

  IF normalized LIKE '%fato relevante%'
  THEN
    RETURN 'material_fact';
  END IF;

  IF normalized LIKE '%comunicado ao mercado%'
    OR normalized LIKE '%comunicado%'
  THEN
    RETURN 'market_announcement';
  END IF;

  IF normalized LIKE '%subscr%'
    OR normalized LIKE '%emiss%'
  THEN
    RETURN 'subscription_issuance';
  END IF;

  IF normalized LIKE '%assembleia%'
  THEN
    RETURN 'shareholder_meeting';
  END IF;

  RETURN coalesce(current_type, 'other_official_document');
END;
$$;

CREATE OR REPLACE FUNCTION market_data_apply_document_type_inference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source = 'fundosnet_b3' THEN
    NEW.document_type := market_data_infer_document_type(NEW.title, NEW.metadata, NEW.document_type);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS market_data_documents_infer_type ON market_data_documents;

CREATE TRIGGER market_data_documents_infer_type
BEFORE INSERT OR UPDATE OF title, metadata, document_type, source
ON market_data_documents
FOR EACH ROW
EXECUTE FUNCTION market_data_apply_document_type_inference();

UPDATE market_data_documents
SET document_type = market_data_infer_document_type(title, metadata, document_type),
    title = replace(replace(replace(replace(title, '&ccedil;', 'ç'), '&otilde;', 'õ'), '&atilde;', 'ã'), '&eacute;', 'é'),
    updated_at = NOW()
WHERE source = 'fundosnet_b3';
