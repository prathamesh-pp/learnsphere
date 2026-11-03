import { z } from "zod";

const accepted = {
  video: new Map([[".mp4", "video/mp4"]]),
  document: new Map([[".pdf", "application/pdf"]]),
  resource: new Map([
    [".pdf", "application/pdf"], [".txt", "text/plain"], [".csv", "text/csv"], [".zip", "application/zip"],
    [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
    [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ]),
} as const;
export const maxMediaBytes = { video: 100 * 1000 * 1000, document: 10 * 1000 * 1000, resource: 10 * 1000 * 1000 } as const;
export const allowedMediaTypes = accepted;

export const uploadGrantSchema = z.object({
  purpose: z.enum(["video", "document", "resource"]),
  fileName: z.string().trim().min(1).max(180).refine((name) => !/[\\/\0]/.test(name) && name !== "." && name !== "..", "Use a file name without a path."),
  contentType: z.string().trim().toLowerCase().max(120),
  sizeBytes: z.number().int().positive().max(maxMediaBytes.video),
}).strict().superRefine((input, context) => {
  const extension = input.fileName.slice(input.fileName.lastIndexOf(".")).toLowerCase();
  if ((accepted[input.purpose] as ReadonlyMap<string, string>).get(extension) !== input.contentType) context.addIssue({ code: "custom", path: ["contentType"], message: "File extension and MIME type do not match an allowed format." });
  if (input.sizeBytes > maxMediaBytes[input.purpose]) context.addIssue({ code: "custom", path: ["sizeBytes"], message: "File exceeds the size limit for this resource type." });
});
export const finalizeMediaSchema = z.object({
  public_id: z.string().min(1).max(255),
  version: z.union([z.string(), z.number()]),
  signature: z.string().regex(/^[a-f\d]{40,64}$/i),
}).strict();
export const mediaAssetIdSchema = z.object({ assetId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
