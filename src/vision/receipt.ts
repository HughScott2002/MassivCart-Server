import { z } from "zod";
import { err, ok, type Result } from "../lib/result.js";
import { extractJsonObjectText } from "./json.js";
import type { SupportedMediaType, VisionError } from "./types.js";

export const MAX_ITEMS = 200;
const MAX_ERROR_RAW_CHARS = 2_000;
const MAX_SCHEMA_ISSUES = 10;

export interface ReceiptItem {
  name: string;
  price: number;
  quantity?: number;
  unit?: string;
  dosage?: string;
}

export interface ReceiptData {
  store?: string | null;
  address?: string | null;
  addressConfident?: boolean;
  date?: string | null;
  items: ReceiptItem[];
  total?: number;
  currency?: string;
  rawText?: string;
  imageType?:
    | "receipt"
    | "shopping_list"
    | "prescription"
    | "gas_price"
    | "unknown";
  prescriber?: string | null;
  patient?: string | null;
}

const imageTypeSchema = z.enum([
  "receipt",
  "shopping_list",
  "prescription",
  "gas_price",
  "unknown",
]);

const rawItemSchema = z.object({
  name: z.string(),
  price: z.number().nullish(),
  quantity: z.number().nullish(),
  unit: z.string().nullish(),
  dosage: z.string().nullish(),
});

const rawReceiptSchema = z.object({
  store: z.string().nullish(),
  address: z.string().nullish(),
  addressConfident: z.boolean().nullish(),
  date: z.string().nullish(),
  items: z.array(rawItemSchema).max(MAX_ITEMS).nullish(),
  total: z.number().nullish(),
  currency: z.string().nullish(),
  rawText: z.string().nullish(),
  imageType: imageTypeSchema.nullish(),
  type: imageTypeSchema.nullish(), // legacy field name some replies use
  prescriber: z.string().nullish(),
  patient: z.string().nullish(),
});

/**
 * Model reply text → validated, fully-defaulted ReceiptData.
 * Garbage shapes become schema errors instead of silently-defaulted data;
 * a failed classification ("unknown") is its own error kind so callers can 422.
 */
export function parseReceiptResponse(raw: string): Result<ReceiptData, VisionError> {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonObjectText(raw));
  } catch {
    return err({
      kind: "malformed_json",
      raw: raw.slice(0, MAX_ERROR_RAW_CHARS),
      retryable: false,
    });
  }

  const parsed = rawReceiptSchema.safeParse(json);
  if (!parsed.success) {
    return err({
      kind: "schema",
      issues: parsed.error.issues
        .slice(0, MAX_SCHEMA_ISSUES)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      retryable: false,
    });
  }

  const value = parsed.data;
  const imageType = value.imageType ?? value.type ?? "unknown";
  if (imageType === "unknown") {
    return err({ kind: "unrecognized_image", retryable: false });
  }

  return ok({
    store: value.store ?? null,
    address: value.address ?? null,
    addressConfident: value.addressConfident ?? false,
    date: value.date ?? null,
    items: (value.items ?? [])
      .filter((item) => item.name.trim().length > 0)
      .map((item) => ({
        name: item.name,
        price: item.price ?? 0,
        quantity: item.quantity ?? 1,
        unit: item.unit ?? undefined,
        dosage: item.dosage ?? undefined,
      })),
    total: value.total ?? 0,
    currency: value.currency ?? "JMD",
    rawText: value.rawText ?? undefined,
    imageType,
    prescriber: value.prescriber ?? null,
    patient: value.patient ?? null,
  });
}

export function normalizeMediaType(contentType?: string): SupportedMediaType {
  const value = (contentType ?? "").toLowerCase().trim();
  if (
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "image/webp" ||
    value === "image/gif"
  ) {
    return value;
  }

  return "image/jpeg";
}
