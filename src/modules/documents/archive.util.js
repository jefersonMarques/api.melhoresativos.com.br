import { inflateRawSync } from "node:zlib";
import { AppError } from "../../core/errors.js";

export function extractZipEntries(buffer) {
  const entries = [];
  const endOfDirectory = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(endOfDirectory + 10);
  let offset = buffer.readUInt32LE(endOfDirectory + 16);

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new AppError(502, "INVALID_UPSTREAM_ARCHIVE", "Arquivo ZIP da fonte oficial possui estrutura inválida");
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const content = readEntry(buffer, localOffset, compressionMethod, compressedSize, uncompressedSize);
    if (!name.endsWith("/")) {
      entries.push({ name, content });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readEntry(buffer, offset, compressionMethod, compressedSize, uncompressedSize) {
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new AppError(502, "INVALID_UPSTREAM_ARCHIVE", "Entrada ZIP da fonte oficial possui estrutura inválida");
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(start, start + compressedSize);
  const content = compressionMethod === 0
    ? compressed
    : compressionMethod === 8
      ? inflateRawSync(compressed)
      : null;
  if (!content) {
    throw new AppError(502, "UNSUPPORTED_UPSTREAM_ARCHIVE", "Compactação ZIP não suportada na fonte oficial");
  }
  if (uncompressedSize && content.length !== uncompressedSize) {
    throw new AppError(502, "INVALID_UPSTREAM_ARCHIVE", "Conteúdo ZIP oficial não passou na validação de tamanho");
  }
  return content;
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new AppError(502, "INVALID_UPSTREAM_ARCHIVE", "Não foi possível ler o ZIP retornado pela fonte oficial");
}
