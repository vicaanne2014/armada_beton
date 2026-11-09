export interface SniffedFile {
  type: string;
  ext: string;
}

/**
 * Tipe berkas ditentukan dari isinya (magic bytes), bukan dari nama atau Content-Type kiriman klien.
 * Hanya format yang diizinkan untuk lampiran surat jalan: JPEG, PNG, WEBP, PDF.
 */
export function sniffFile(b: Uint8Array): SniffedFile | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return { type: "image/png", ext: "png" };
  }
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return { type: "application/pdf", ext: "pdf" };
  }
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP"
  ) {
    return { type: "image/webp", ext: "webp" };
  }
  return null;
}
