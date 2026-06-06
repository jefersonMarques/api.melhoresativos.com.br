import { AppError } from "../../core/errors.js";

export class DocumentsService {
  constructor({ repository, cvmFiiProvider = null, fnetFiiProvider = null, fundamentusProvider = null, config }) {
    this.repository = repository;
    this.cvmFiiProvider = cvmFiiProvider;
    this.fnetFiiProvider = fnetFiiProvider;
    this.fundamentusProvider = fundamentusProvider;
    this.config = config;
  }

  async sync(symbols) {
    const uniqueSymbols = [...new Set(symbols)];
    const settled = await Promise.allSettled(uniqueSymbols.map((symbol) => this.#syncSymbol(symbol)));
    return settled.map((result, index) => result.status === "fulfilled"
      ? result.value
      : { symbol: uniqueSymbols[index], status: "failed", errors: [errorMessage(result.reason)] });
  }

  async list(symbol, filters) {
    return {
      symbol,
      identity: await this.repository.getAssetRegistry(symbol),
      syncState: await this.repository.listDocumentSyncState(symbol),
      documents: await this.repository.listDocuments(symbol, filters)
    };
  }

  async listRecent(symbols, filters) {
    return this.repository.listRecentDocuments(symbols, filters);
  }

  async get(symbol, documentId) {
    const document = await this.repository.getDocument(symbol, documentId);
    if (!document) {
      throw new AppError(404, "NOT_FOUND", "Documento não encontrado");
    }
    return document;
  }

  async #syncSymbol(symbol) {
    let identity = await this.repository.getAssetRegistry(symbol);
    let identityFailure = null;
    if (!identity?.cnpj && this.config.fundamentusEnabled !== false && this.fundamentusProvider?.fetchFiiIdentity) {
      try {
        const discovered = await this.fundamentusProvider.fetchFiiIdentity(symbol);
        identity = await this.repository.upsertAssetRegistry({
          ...discovered,
          sourceMetadata: { ...discovered.sourceMetadata, officialValidationPending: true },
          resolutionStatus: "pending_validation"
        });
      } catch (error) {
        identityFailure = { sourceUrl: "fundamentus_identity_discovery", message: error.message };
      }
    }

    const providerResults = [];
    if (this.config.cvmFiiEnabled !== false && this.cvmFiiProvider) {
      const result = await this.cvmFiiProvider.fetchDocuments(symbol, identity);
      providerResults.push({ ...result, source: "cvm_open_data" });
      if (identityFailure && !result.identity) result.failures.push(identityFailure);
      if (result.identity) {
        identity = await this.repository.upsertAssetRegistry({
          ...result.identity,
          resolutionStatus: "resolved",
          resolutionError: null,
          resolvedAt: new Date().toISOString()
        });
      }
    }
    if (this.config.fnetFiiEnabled && this.fnetFiiProvider) {
      providerResults.push(await this.fnetFiiProvider.fetchDocuments(symbol, identity));
    }

    if (!identity?.cnpj) {
      await this.repository.upsertAssetRegistry({ symbol, assetType: "fii", resolutionStatus: "unresolved", resolutionError: "Identidade não localizada nos informes oficiais consultados" });
    }

    let inserted = 0;
    let updated = 0;
    const errors = [];
    for (const result of providerResults) {
      for (const document of result.documents) {
        const saved = await this.repository.upsertDocument(document);
        if (hasExtractedText(document.content)) {
          await this.repository.setDocumentContent(saved.id, document.content);
        }
        saved.wasInserted ? inserted += 1 : updated += 1;
      }
      const lastDocument = result.documents.map((document) => document.referenceDate).filter(Boolean).sort().at(-1) ?? null;
      await this.repository.setDocumentSyncState(symbol, result.source, {
        success: result.documents.length > 0 || result.failures.length === 0,
        lastDocumentAt: lastDocument,
        error: result.failures.length ? result.failures.map((failure) => failure.message).join(" | ") : null
      });
      errors.push(...result.failures.map((failure) => ({ source: result.source, ...failure })));
    }

    const found = providerResults.reduce((total, result) => total + result.documents.length, 0);
    return {
      symbol,
      status: errors.length && !found ? "failed" : errors.length ? "partial" : "success",
      identity,
      documents: { found, inserted, updated },
      sources: providerResults.map((result) => ({ source: result.source, found: result.documents.length, errors: result.failures.length })),
      errors
    };
  }
}

function hasExtractedText(content) {
  return Boolean(content?.rawText && content.extractionStatus === "extracted");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Falha desconhecida ao sincronizar documentos";
}
