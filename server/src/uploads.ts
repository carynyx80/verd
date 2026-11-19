// Image uploads for agent logos and banners.
// Every upload is decoded and re-encoded with sharp, which strips metadata,
// rejects anything that isn't a real raster image, and normalises size.
// Files are content-addressed (sha256 of the output), so ids are stable and
// can be cached forever.
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import sharp from "sharp";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.resolve(DATA_DIR, "uploads");

export const IMAGE_ID = /^[a-f0-9]{32}\.webp$/;
export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type ImageKind = "logo" | "banner";

const SPECS: Record<ImageKind, { width: number; height: number }> = {
  logo: { width: 256, height: 256 },
  banner: { width: 1500, height: 500 },
};

export class UploadError extends Error {}

export async function saveImage(input: Buffer, kind: ImageKind): Promise<string> {
  const spec = SPECS[kind];
  let out: Buffer;
  try {
    out = await sharp(input, { limitInputPixels: 40_000_000, animated: false })
      .rotate() // honour EXIF orientation before metadata is dropped
      .resize(spec.width, spec.height, { fit: "cover", position: "attention" })
      .webp({ quality: 86 })
      .toBuffer();
  } catch {
    throw new UploadError("That file isn't a supported image. Use PNG, JPG, WebP or GIF.");
  }
  const id = createHash("sha256").update(out).digest("hex").slice(0, 32) + ".webp";
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const file = path.join(UPLOAD_DIR, id);
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, out);
  }
  return id;
}

export async function imageExists(id: string): Promise<boolean> {
  if (!IMAGE_ID.test(id)) return false;
  try {
    await fs.access(path.join(UPLOAD_DIR, id));
    return true;
  } catch {
    return false;
  }
}
