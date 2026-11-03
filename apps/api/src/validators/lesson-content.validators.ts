import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const httpsUrl = z.url().max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}, "Use a safe HTTPS URL.");

export const richTextBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]), text: z.string().trim().min(1).max(500) }).strict(),
  z.object({ type: z.literal("paragraph"), text: z.string().max(10000) }).strict(),
  z.object({ type: z.literal("bulleted_list"), items: z.array(z.string().trim().min(1).max(1000)).min(1).max(100) }).strict(),
  z.object({ type: z.literal("numbered_list"), items: z.array(z.string().trim().min(1).max(1000)).min(1).max(100) }).strict(),
  z.object({ type: z.literal("code"), language: z.string().trim().max(40).default("text"), code: z.string().max(20000) }).strict(),
  z.object({ type: z.literal("link"), title: z.string().trim().min(1).max(120), url: httpsUrl }).strict(),
]);

const textContentSchema = z.object({ type: z.literal("text"), blocks: z.array(richTextBlockSchema).min(1).max(200) }).strict();
const videoContentSchema = z.discriminatedUnion("source", [
  z.object({ type: z.literal("video"), source: z.literal("external"), title: z.string().trim().min(1).max(120), url: httpsUrl, durationSeconds: z.number().int().min(1).max(86400) }).strict(),
  z.object({ type: z.literal("video"), source: z.literal("asset"), assetId: objectId, durationSeconds: z.number().int().min(1).max(86400) }).strict(),
]);
const documentContentSchema = z.object({ type: z.literal("document"), assetId: objectId, fileName: z.string().trim().min(1).max(180), mimeType: z.literal("application/pdf"), sizeBytes: z.number().int().min(1).max(10 * 1000 * 1000) }).strict();
const resourceContentSchema = z.object({ type: z.literal("resource"), files: z.array(z.object({ assetId: objectId, title: z.string().trim().min(1).max(120), description: z.string().trim().max(500).default(""), fileName: z.string().trim().min(1).max(180), mimeType: z.string().trim().min(1).max(120), sizeBytes: z.number().int().min(1).max(10 * 1000 * 1000) }).strict()).min(1).max(10) }).strict();
const externalLinkContentSchema = z.object({ type: z.literal("external_link"), title: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).default(""), url: httpsUrl }).strict();

export const lessonContentSchema = z.discriminatedUnion("type", [textContentSchema, videoContentSchema, documentContentSchema, resourceContentSchema, externalLinkContentSchema]);
export type LessonContent = z.infer<typeof lessonContentSchema>;
export type RichTextBlock = z.infer<typeof richTextBlockSchema>;

export const lessonContentTypeSchema = z.enum(["text", "video", "document", "resource", "external_link", "external_video", "resources"]);

export function contentMatchesType(contentType: string, content: LessonContent): boolean {
  return contentType === content.type || (contentType === "external_video" && content.type === "video") || (contentType === "resources" && content.type === "resource");
}

export function isStorageBackedContent(content: LessonContent): boolean {
  return content.type === "document" || content.type === "resource" || (content.type === "video" && content.source === "asset");
}
