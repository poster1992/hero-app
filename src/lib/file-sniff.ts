// Erkennt den Dateityp aus den ersten Bytes (Magic Number) – nützlich, wenn ein
// Absender die Datei ohne Endung / mit falschem MIME schickt (z. B. octet-stream).

/** Liefert den erkannten MIME-Typ aus dem Dateiinhalt (oder `fallback`). */
export function sniffMime(buf: Buffer, fallback = "application/octet-stream"): string {
  if (buf.length >= 4) {
    // %PDF
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf";
    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
    // JPEG
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
    // GIF
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
    // TIFF (II* / MM*)
    if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a) || (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00))
      return "image/tiff";
    // BMP
    if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  }
  // RIFF....WEBP
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  // ISO-BMFF: ....ftyp<brand> (HEIC/HEIF)
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12).toLowerCase();
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "heif", "msf1"].includes(brand)) return "image/heic";
  }
  return fallback;
}

/** Kann dieser MIME-Typ im Browser inline angezeigt werden? */
export function isPreviewableMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return mime === "application/pdf" || mime.startsWith("image/");
}

/** Passende Dateiendung zu einem MIME-Typ (für saubere stored_name-Endungen). */
export function extForMime(mime: string | null | undefined): string {
  switch ((mime ?? "").toLowerCase()) {
    case "application/pdf":
      return ".pdf";
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/tiff":
      return ".tiff";
    case "image/bmp":
      return ".bmp";
    case "image/heic":
      return ".heic";
    default:
      return "";
  }
}
