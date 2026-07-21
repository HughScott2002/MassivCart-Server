import { test } from "node:test";
import assert from "node:assert/strict";
import { err, ok } from "../src/lib/result.js";
import {
  extractReceipt,
  normalizeMediaType,
  openrouterAnalyzer,
  parseReceiptResponse,
  type AnalyzeImage,
  type ReceiptImageUpload,
  type VisionError,
} from "../src/vision/index.js";

const upload: ReceiptImageUpload = {
  buffer: Buffer.from("fake-image-bytes"),
  filename: "receipt.jpg",
  mediaType: "image/jpeg",
};

const validReply = JSON.stringify({
  store: "HI-LO",
  address: null,
  addressConfident: false,
  date: "2026-07-18",
  items: [{ name: "RICE 1KG", price: 350, quantity: 2, unit: null, dosage: null }],
  total: 700,
  currency: "JMD",
  imageType: "receipt",
  prescriber: null,
  patient: null,
});

const analyzeWith =
  (reply: string): AnalyzeImage =>
  async () =>
    ok(reply);

test("extractReceipt: valid reply parses and defaults", async () => {
  const result = await extractReceipt(upload, analyzeWith(validReply));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.store, "HI-LO");
    assert.equal(result.value.items.length, 1);
    assert.equal(result.value.items[0].quantity, 2);
    assert.equal(result.value.imageType, "receipt");
  }
});

test("parseReceiptResponse: tolerates fenced JSON and legacy type field", () => {
  const fenced = "```json\n" + JSON.stringify({ type: "shopping_list", items: [{ name: "milk" }] }) + "\n```";
  const result = parseReceiptResponse(fenced);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.imageType, "shopping_list");
    assert.equal(result.value.items[0].price, 0);
    assert.equal(result.value.items[0].quantity, 1);
    assert.equal(result.value.currency, "JMD");
  }
});

test("parseReceiptResponse: unknown classification is unrecognized_image", () => {
  const result = parseReceiptResponse(JSON.stringify({ imageType: "unknown", items: [] }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.kind, "unrecognized_image");
  }
});

test("parseReceiptResponse: missing imageType is unrecognized_image", () => {
  const result = parseReceiptResponse(JSON.stringify({ items: [] }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.kind, "unrecognized_image");
  }
});

test("parseReceiptResponse: non-JSON reply is malformed_json", () => {
  const result = parseReceiptResponse("I could not read this image, sorry!");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.kind, "malformed_json");
    assert.equal(result.error.retryable, false);
  }
});

test("parseReceiptResponse: wrong types are a schema error with issues", () => {
  const result = parseReceiptResponse(
    JSON.stringify({ imageType: "receipt", items: [{ name: "RICE", price: "three hundred" }] }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.kind, "schema");
    if (result.error.kind === "schema") {
      assert.equal(result.error.issues.length > 0, true);
    }
  }
});

test("parseReceiptResponse: empty-name items are dropped, not fatal", () => {
  const result = parseReceiptResponse(
    JSON.stringify({
      imageType: "receipt",
      items: [{ name: "  " }, { name: "BREAD", price: 500 }],
    }),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.items.length, 1);
    assert.equal(result.value.items[0].name, "BREAD");
  }
});

test("extractReceipt: retries retryable errors, bounded", async () => {
  let calls = 0;
  const flaky: AnalyzeImage = async () => {
    calls += 1;
    return err<VisionError>({ kind: "http", status: 503, body: "unavailable", retryable: true });
  };
  const result = await extractReceipt(upload, flaky);
  assert.equal(calls, 2);
  assert.equal(result.ok, false);
});

test("extractReceipt: does not retry non-retryable errors", async () => {
  let calls = 0;
  const unauthorized: AnalyzeImage = async () => {
    calls += 1;
    return err<VisionError>({ kind: "http", status: 401, body: "bad key", retryable: false });
  };
  const result = await extractReceipt(upload, unauthorized);
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  if (!result.ok && result.error.kind === "http") {
    assert.equal(result.error.status, 401);
  }
});

test("extractReceipt: recovers when the retry succeeds", async () => {
  let calls = 0;
  const flakyThenOk: AnalyzeImage = async () => {
    calls += 1;
    return calls === 1
      ? err<VisionError>({ kind: "empty_response", retryable: true })
      : ok(validReply);
  };
  const result = await extractReceipt(upload, flakyThenOk);
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
});

test("extractReceipt: empty buffer is a programmer error and throws", async () => {
  await assert.rejects(
    () =>
      extractReceipt(
        { ...upload, buffer: Buffer.alloc(0) },
        analyzeWith(validReply),
      ),
    /Assertion failed/,
  );
});

test("openrouterAnalyzer: missing config is a programmer error and throws", () => {
  assert.throws(() => openrouterAnalyzer({ apiKey: "", model: "x" }), /Assertion failed/);
  assert.throws(() => openrouterAnalyzer({ apiKey: "sk-or-x", model: "" }), /Assertion failed/);
});

test("normalizeMediaType: known types pass, unknown falls back to jpeg", () => {
  assert.equal(normalizeMediaType("image/png"), "image/png");
  assert.equal(normalizeMediaType("IMAGE/WEBP "), "image/webp");
  assert.equal(normalizeMediaType("application/pdf"), "image/jpeg");
  assert.equal(normalizeMediaType(undefined), "image/jpeg");
});
