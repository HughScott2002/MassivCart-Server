// Run the vision module standalone against a real image, without booting the API:
//   OPENROUTER_API_KEY=... npx tsx scripts/vision-extract.ts path/to/receipt.jpg
import "dotenv/config";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import {
  DEFAULT_VISION_MODEL,
  extractReceipt,
  normalizeMediaType,
  openrouterAnalyzer,
} from "../src/vision/index.js";

const EXTENSION_TO_MEDIA_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

async function main(): Promise<void> {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error("Usage: npx tsx scripts/vision-extract.ts <image-path>");
    process.exit(1);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENROUTER_API_KEY (set it in .env or the environment)");
    process.exit(1);
  }

  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_VISION_MODEL;
  const analyze = openrouterAnalyzer({ apiKey, model });
  const upload = {
    buffer: readFileSync(imagePath),
    filename: imagePath,
    mediaType: normalizeMediaType(EXTENSION_TO_MEDIA_TYPE[extname(imagePath).toLowerCase()]),
  };

  console.error(`model: ${model}, image: ${imagePath} (${upload.buffer.length} bytes)`);
  const result = await extractReceipt(upload, analyze, (message, context) =>
    console.error(`[vision] ${message}`, JSON.stringify(context)),
  );

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
