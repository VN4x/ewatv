import { isPlayoutBackend } from "@/lib/playout-backend/config";

const MAX_OVERLAY_DATA_URL_BYTES = 512 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Read a small image as a data URL for overlay preview (playout mode — no cloud storage). */
export async function readOverlayDataUrl(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Use PNG, JPEG, WebP, or GIF");
  }
  if (file.size > MAX_OVERLAY_DATA_URL_BYTES) {
    throw new Error(`Image must be under ${MAX_OVERLAY_DATA_URL_BYTES / 1024} KB`);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function overlayUploadSupported(): boolean {
  return isPlayoutBackend();
}
