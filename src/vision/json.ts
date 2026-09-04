/** Pull the JSON object out of a model reply that may wrap it in fences or prose. */
export function extractJsonObjectText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const startIndex = candidate.indexOf("{");
  const endIndex = candidate.lastIndexOf("}");

  if (startIndex >= 0 && endIndex > startIndex) {
    return candidate.slice(startIndex, endIndex + 1);
  }

  return candidate;
}
