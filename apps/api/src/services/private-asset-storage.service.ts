import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import cloudinary from "cloudinary";
import type { AppConfig } from "../config/env.js";

export type PrivateAssetPurpose = "video" | "document" | "resource";
export type CloudinaryResourceType = "video" | "raw";
export interface PrivateUploadRequest {
  tenantId: string; courseId: string; lessonId: string; actorId: string; intentId: string;
  purpose: PrivateAssetPurpose; fileName: string; contentType: string; sizeBytes: number; maxSizeBytes: number;
  publicId: string; resourceType: CloudinaryResourceType;
}
export interface PrivateUploadGrant { intentId: string; uploadUrl: string; expiresAt: string; maxSizeBytes: number; }
export interface ProviderAsset {
  assetId: string; publicId: string; resourceType: CloudinaryResourceType; deliveryType: string;
  format: string; sizeBytes: number; version: number; responseSignature: string; durationSeconds?: number; width?: number; height?: number;
}
export interface PrivateAssetStorageProvider {
  createUploadGrant(request: PrivateUploadRequest): Promise<PrivateUploadGrant>;
  upload(request: PrivateUploadRequest, source: NodeJS.ReadableStream): Promise<ProviderAsset>;
  getVerifiedAsset(request: PrivateUploadRequest, upload: ProviderAsset): Promise<ProviderAsset>;
  createDownloadGrant(input: { publicId: string; format: string; resourceType: CloudinaryResourceType; disposition: "inline" | "attachment" }): Promise<{ url: string; expiresAt: string }>;
  deleteAsset(input: { publicId: string; resourceType: CloudinaryResourceType }): Promise<void>;
}

export class MediaProviderError extends Error {
  constructor(readonly code: "MEDIA_STORAGE_UNAVAILABLE" | "MEDIA_UPLOAD_REJECTED" | "MEDIA_QUOTA_EXHAUSTED" | "MEDIA_CONFIGURATION_INVALID" | "MEDIA_PROVIDER_TIMEOUT" | "MEDIA_DELIVERY_UNVERIFIED" = "MEDIA_STORAGE_UNAVAILABLE") {
    super(code); this.name = "MediaProviderError";
  }
}
export class PrivateAssetStorageUnavailableError extends MediaProviderError {
  constructor() { super("MEDIA_STORAGE_UNAVAILABLE"); this.name = "PrivateAssetStorageUnavailableError"; }
}

/** Fails closed unless a server-side provider has been explicitly configured. */
export class UnconfiguredPrivateAssetStorage implements PrivateAssetStorageProvider {
  async createUploadGrant(_request: PrivateUploadRequest): Promise<PrivateUploadGrant> { throw new PrivateAssetStorageUnavailableError(); }
  async upload(_request: PrivateUploadRequest, _source: NodeJS.ReadableStream): Promise<ProviderAsset> { throw new PrivateAssetStorageUnavailableError(); }
  async getVerifiedAsset(_request: PrivateUploadRequest, _upload: ProviderAsset): Promise<ProviderAsset> { throw new PrivateAssetStorageUnavailableError(); }
  async createDownloadGrant(_input: { publicId: string; format: string; resourceType: CloudinaryResourceType; disposition: "inline" | "attachment" }): Promise<{ url: string; expiresAt: string }> { throw new PrivateAssetStorageUnavailableError(); }
  async deleteAsset(_input: { publicId: string; resourceType: CloudinaryResourceType }): Promise<void> { throw new PrivateAssetStorageUnavailableError(); }
}

type CloudinaryConfig = { cloud_name?: string; api_key?: string; api_secret?: string };
export function normalizeProviderError(error: unknown): MediaProviderError {
  const row = typeof error === "object" && error !== null ? error as { http_code?: number; code?: string; message?: string } : {};
  if (row.http_code === 420 || row.http_code === 429 || /quota|credit|plan limit/i.test(row.message ?? "")) return new MediaProviderError("MEDIA_QUOTA_EXHAUSTED");
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(`${row.code ?? ""} ${row.message ?? ""}`)) return new MediaProviderError("MEDIA_PROVIDER_TIMEOUT");
  if (row.http_code === 401) return new MediaProviderError("MEDIA_CONFIGURATION_INVALID");
  if (row.http_code === 400 || row.http_code === 403) return new MediaProviderError("MEDIA_UPLOAD_REJECTED");
  return new MediaProviderError("MEDIA_STORAGE_UNAVAILABLE");
}

export class CloudinaryPrivateAssetStorage implements PrivateAssetStorageProvider {
  private readonly client: typeof cloudinary.v2;
  constructor(config: Required<CloudinaryConfig>, privateDeliveryVerified = false) {
    this.client = cloudinary.v2;
    this.privateDeliveryVerified = privateDeliveryVerified;
    this.client.config({ cloud_name: config.cloud_name, api_key: config.api_key, api_secret: config.api_secret, secure: true, signature_algorithm: "sha256" });
  }
  private readonly privateDeliveryVerified: boolean;

  async createUploadGrant(request: PrivateUploadRequest): Promise<PrivateUploadGrant> {
    return { intentId: request.intentId, uploadUrl: `/api/v1/instructor/courses/${request.courseId}/lessons/${request.lessonId}/media-upload-intents/${request.intentId}/content`, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), maxSizeBytes: request.maxSizeBytes };
  }

  async upload(request: PrivateUploadRequest, source: NodeJS.ReadableStream): Promise<ProviderAsset> {
    let bytesSeen = 0;
    const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytesSeen += chunk.length;
      if (bytesSeen > request.maxSizeBytes) { callback(new Error("Upload exceeds the configured media limit.")); return; }
      callback(null, chunk);
    } });
    // The SDK creates the authenticated upload signature server-side. No Cloudinary key or secret reaches the browser.
    const upload = new Promise<ProviderAsset>((resolve, reject) => {
      const stream = this.client.uploader.upload_stream({
        resource_type: request.resourceType, type: "authenticated", public_id: request.publicId,
        overwrite: false, unique_filename: false, use_filename: false, access_mode: "authenticated",
        context: { intent_id: request.intentId }, timeout: 120_000,
      }, (error, result) => {
        if (error || !result) { reject(normalizeProviderError(error)); return; }
        resolve({ assetId: result.asset_id, publicId: result.public_id, resourceType: result.resource_type as CloudinaryResourceType, deliveryType: result.type, format: result.format, sizeBytes: result.bytes, version: result.version, responseSignature: result.signature, ...(typeof result.duration === "number" ? { durationSeconds: result.duration } : {}), ...(typeof result.width === "number" ? { width: result.width } : {}), ...(typeof result.height === "number" ? { height: result.height } : {}) });
      });
      source.on("error", (error) => { limiter.destroy(error); stream.destroy(error); });
      limiter.on("error", (error) => { stream.destroy(error); reject(new MediaProviderError("MEDIA_UPLOAD_REJECTED")); });
      source.pipe(limiter).pipe(stream);
    });
    try { return await upload; } catch (error) { if (error instanceof MediaProviderError) throw error; throw normalizeProviderError(error); }
  }

  async getVerifiedAsset(request: PrivateUploadRequest, upload: ProviderAsset): Promise<ProviderAsset> {
    try {
      const verify = (this.client.utils as unknown as { verify_api_response_signature?: (publicId: string, version: number, signature: string) => boolean }).verify_api_response_signature;
      if (!verify || !upload.responseSignature || !verify(upload.publicId, upload.version, upload.responseSignature)) throw new MediaProviderError("MEDIA_UPLOAD_REJECTED");
      const response = await this.client.api.resource(request.publicId, { resource_type: request.resourceType, type: "authenticated", timeout: 15_000 });
      if (response.public_id !== request.publicId || response.asset_id !== upload.assetId || response.resource_type !== request.resourceType || response.type !== "authenticated" || response.bytes !== upload.sizeBytes || response.version !== upload.version) throw new MediaProviderError("MEDIA_UPLOAD_REJECTED");
      return { assetId: response.asset_id, publicId: response.public_id, resourceType: response.resource_type, deliveryType: response.type, format: response.format, sizeBytes: response.bytes, version: response.version, responseSignature: upload.responseSignature, ...(typeof response.duration === "number" ? { durationSeconds: response.duration } : {}), ...(typeof response.width === "number" ? { width: response.width } : {}), ...(typeof response.height === "number" ? { height: response.height } : {}) };
    } catch (error) { if (error instanceof MediaProviderError) throw error; throw normalizeProviderError(error); }
  }

  async createDownloadGrant(input: { publicId: string; format: string; resourceType: CloudinaryResourceType; disposition: "inline" | "attachment" }) {
    if (!this.privateDeliveryVerified) throw new MediaProviderError("MEDIA_DELIVERY_UNVERIFIED");
    try {
      const expiresAtSeconds = Math.floor(Date.now() / 1000) + 5 * 60;
      const url = this.client.utils.private_download_url(input.publicId, input.format, { resource_type: input.resourceType, type: "authenticated", expires_at: expiresAtSeconds, attachment: input.disposition === "attachment" });
      return { url, expiresAt: new Date(expiresAtSeconds * 1000).toISOString() };
    } catch (error) { throw normalizeProviderError(error); }
  }

  async deleteAsset(input: { publicId: string; resourceType: CloudinaryResourceType }) {
    try {
      const result = await this.client.uploader.destroy(input.publicId, { resource_type: input.resourceType, type: "authenticated", invalidate: true });
      if (result.result !== "ok" && result.result !== "not found") throw new MediaProviderError("MEDIA_STORAGE_UNAVAILABLE");
    } catch (error) { if (error instanceof MediaProviderError) throw error; throw normalizeProviderError(error); }
  }
}

let privateAssetStorage: PrivateAssetStorageProvider = new UnconfiguredPrivateAssetStorage();
export function configurePrivateAssetStorage(config: AppConfig): void {
  if (config.mediaStorageProvider === "cloudinary") {
    if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) throw new MediaProviderError("MEDIA_CONFIGURATION_INVALID");
    privateAssetStorage = new CloudinaryPrivateAssetStorage({ cloud_name: config.cloudinaryCloudName, api_key: config.cloudinaryApiKey, api_secret: config.cloudinaryApiSecret }, config.cloudinaryPrivateDeliveryVerified);
  } else privateAssetStorage = new UnconfiguredPrivateAssetStorage();
}
export function getPrivateAssetStorage(): PrivateAssetStorageProvider { return privateAssetStorage; }
export function setPrivateAssetStorageProvider(provider: PrivateAssetStorageProvider): void { privateAssetStorage = provider; }
export function newCloudinaryPublicId(tenantId: string, courseId: string, lessonId: string) { return `learnsphere/${tenantId}/${courseId}/${lessonId}/${randomUUID()}`; }
