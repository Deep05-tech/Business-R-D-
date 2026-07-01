import { z } from "zod";
import type { BusinessInput } from "./types.js";

const urlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Only HTTP and HTTPS URLs are supported",
  });

export const businessInputSchema = z
  .object({
    websiteUrl: urlSchema,
    socialUrls: z.array(urlSchema).default([]),
  })
  .strict();

export function parseBusinessInput(value: unknown): BusinessInput {
  const parsed = businessInputSchema.parse(value);
  return {
    websiteUrl: normalizeUrl(parsed.websiteUrl),
    socialUrls: parsed.socialUrls.map(normalizeUrl),
  };
}

export function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}
