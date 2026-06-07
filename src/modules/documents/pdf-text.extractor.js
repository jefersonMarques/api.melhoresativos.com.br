import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class PdfTextExtractor {
  constructor({ enabled = true, binary = "pdftotext", timeoutMs = 30_000, maxOutputBytes = 20_000_000 } = {}) {
    this.enabled = enabled;
    this.binary = binary;
    this.timeoutMs = timeoutMs;
    this.maxOutputBytes = maxOutputBytes;
  }

  async extract(buffer) {
    if (!this.enabled) {
      return {
        rawText: null,
        extractionStatus: "unsupported",
        extractionReason: "pdf_text_extraction_disabled",
        extractionError: "PDF text extraction is disabled"
      };
    }

    const directory = await mkdtemp(join(tmpdir(), "market-data-pdf-"));
    const inputPath = join(directory, "document.pdf");
    try {
      await writeFile(inputPath, buffer);
      const { stdout } = await execFileAsync(this.binary, ["-layout", "-enc", "UTF-8", inputPath, "-"], {
        timeout: this.timeoutMs,
        maxBuffer: this.maxOutputBytes,
        encoding: "utf8"
      });
      const rawText = stdout.trim();
      if (!rawText) {
        return {
          rawText: null,
          extractionStatus: "unsupported",
          extractionReason: "pdf_without_extractable_text",
          extractionError: "PDF does not contain extractable text"
        };
      }
      return {
        rawText,
        extractionStatus: "extracted",
        extractionReason: "pdf_text_extracted",
        extractionError: null,
        extractedAt: new Date().toISOString()
      };
    } catch (error) {
      const missingBinary = error?.code === "ENOENT";
      return {
        rawText: null,
        extractionStatus: missingBinary ? "unsupported" : "failed",
        extractionReason: missingBinary ? "pdf_extractor_binary_missing" : "pdf_extractor_failed",
        extractionError: missingBinary ? `PDF extractor not available: ${this.binary}` : String(error.message ?? error)
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
