import { z } from "zod";

// Blank values in .env (e.g. `UPSTASH_REDIS_REST_URL=`) count as absent.
const optionalEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  SUPABASE_URL: z.string().min(1, "Missing SUPABASE_URL"),
  SUPABASE_ANON_KEY: z.string().min(1, "Missing SUPABASE_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: optionalEnv,
  // Optional: cache.ts falls back to a no-op cache when these are absent.
  UPSTASH_REDIS_REST_URL: optionalEnv,
  UPSTASH_REDIS_REST_TOKEN: optionalEnv,
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const messages = parsedEnv.error.issues.map((issue) => issue.message);
  throw new Error(messages.join("\n"));
}

export const env = parsedEnv.data;
