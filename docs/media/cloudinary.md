# Cloudinary private media

## Current behavior

The API supports Cloudinary as the first implementation of `PrivateAssetStorageProvider`. `MEDIA_STORAGE_PROVIDER=unconfigured` remains the default and all media routes fail closed in that mode. Set Cloudinary configuration in the API process only; do not add these values to Vite variables, browser code, responses, logs, or Git.

The API authorizes an upload against the current instructor membership, course ownership/management, draft course state, and an existing lesson with a matching media type. It writes a single-use upload intent with a random public ID, then streams the file through the authenticated API to the Cloudinary Node SDK. The SDK signs its provider request server-side. The browser receives only an API upload path and limits. Upload response signatures and Admin API metadata are checked before the asset and lesson reference are committed in a MongoDB transaction.

Limits are enforced in the API and again against provider metadata:

| Media | Cloudinary resource type | Maximum |
|---|---|---:|
| `.mp4` video | `video` | 100,000,000 bytes |
| PDF and allowlisted download resources | `raw` | 10,000,000 bytes |
| PNG/JPEG resource files | `raw` | 10,000,000 bytes |

Allowed resource suffixes are PDF, TXT, CSV, ZIP, PNG/JPG/JPEG, DOCX, and PPTX. HTML, scripts, executables, arbitrary formats, client-chosen public IDs and provider URLs are rejected. Metadata attachment is performed only by the verified server path. Draft media lessons may remain incomplete; course publishing rejects them.

Student access checks current organization membership, published course and lesson, active enrollment, asset state, and exact tenant/course/lesson association before producing a five-minute Cloudinary authenticated private-download URL. The API response is non-cacheable. The returned URL is a bearer link until expiry; the Cloudinary API Secret is not part of it. Cloudinary API keys are identifiers, not secrets, and Cloudinary's signed download URL format includes its API key. Do not log or persist signed delivery URLs.

`CLOUDINARY_PRIVATE_DELIVERY_VERIFIED` defaults to `false`. While false, the API does not issue delivery grants even if uploads are configured. Leave it false until the real-account checks below pass for both video and raw PDF/resource delivery.

## Server configuration

Required API environment variable names:

- `MEDIA_STORAGE_PROVIDER`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_PRIVATE_DELIVERY_VERIFIED`

Only the cloud name, API key, and API Secret are account-specific values. Keep the API Secret in a server-side secret manager or local API environment file excluded from Git. The `.env.example` values are placeholders. The API validates that all three Cloudinary values exist when Cloudinary is enabled. With the provider unconfigured, media requests return a sanitized `503` response.

## Routes

- `POST /api/v1/instructor/courses/:courseId/lessons/:lessonId/media-upload-grants` creates a lesson-bound intent; existing managed-course and sensitive-action guards remain in place.
- `PUT /api/v1/instructor/courses/:courseId/lessons/:lessonId/media-upload-intents/:intentId/content` streams raw file bytes. The API checks declared and actual stream lengths and content type, uploads server-side, verifies provider response signature and metadata, and returns success only after the MongoDB transaction attaches a ready asset.
- `GET /api/v1/courses/:courseId/lessons/:lessonId/media-assets/:assetId/access?disposition=inline|attachment` checks current learner access and returns a five-minute signed private-download grant.
- `DELETE /api/v1/instructor/courses/:courseId/lessons/:lessonId/media-assets/:assetId` marks the asset unavailable first and then requests provider deletion. Lesson deletion also marks linked assets for cleanup.

The generated Cloudinary upload and delivery URLs are derived only from server-owned intent/asset records. Errors from the provider are normalized and never returned verbatim. Quota errors do not trigger retries or upgrades. Expired/failed intents and pending deletions are retried by the API reconciliation timer; move this to a durable leased worker before running multiple API instances.

## Real-account verification procedure

Do not put account credentials in a prompt, test report, browser environment, or command-line argument. Configure them in the API's server environment and keep delivery gated while testing.

1. In the Cloudinary Console, verify the account is on the intended Free product environment and review current credits/limits. Keep the account's PDF/archive delivery setting disabled until needed; if enabling it for LearnSphere, enable only the required file types.
2. With `CLOUDINARY_PRIVATE_DELIVERY_VERIFIED=false`, create a draft test course and one video lesson and one PDF document lesson in a disposable test organization. Upload small, non-sensitive MP4 and PDF test files through the instructor UI. Confirm UI success appears only after server verification.
3. In Cloudinary Media Library/Admin API, confirm the resulting assets have `video`/`raw` resource types and `authenticated` delivery type, expected random public IDs, correct format and byte count, and no public `upload` delivery. Do not use client-supplied URLs as evidence.
4. Request each asset's ordinary unsigned delivery URL and confirm Cloudinary denies access. Sign in as an enrolled student and confirm the video plays and PDF opens/downloads. Confirm an unenrolled user, a user with revoked organization membership, and a student requesting another course/lesson asset are denied by the API.
5. Wait more than five minutes and confirm the previously issued private-download URL is rejected. Request access again as the still-enrolled student and confirm a fresh link works. Check browser playback/seeking and PDF range/download behavior on the actual Free account.
6. Before publishing the test course, call the instructor asset deletion endpoint with an authenticated instructor session and CSRF token. Verify the asset becomes unavailable, Cloudinary deletion succeeds, and a repeat delivery request is denied. Also verify lesson deletion schedules linked provider cleanup.
7. Inspect Cloudinary usage after the test and record credit consumption. Only after both private video and raw PDF/resource cases pass should the operator set `CLOUDINARY_PRIVATE_DELIVERY_VERIFIED=true` and restart the API. If any provider behavior is unavailable on the account, leave the flag false; do not replace it with public delivery.

The automated unit and MongoDB tests use a clearly identified mock provider and do not verify Cloudinary account behavior. No real upload, private delivery, expiration, or provider deletion is claimed by those tests.

## Free-plan limitations and operational boundaries

- The Free plan provides 25 monthly credits shared across usage. Credits are not a promise of a fixed storage amount or bandwidth.
- The application enforces the stated 100 MB video and 10 MB raw/image file caps. It does not assume unlimited storage, egress, transformations, or video processing.
- Cloudinary may reject uploads or delivery when credits/limits are exhausted. The API reports a sanitized storage/quota failure; it does not retry indefinitely or silently upgrade.
- PDF/archive delivery may be disabled by default in Free account security settings. The account setting and actual authenticated raw delivery must be verified before enabling the delivery gate.
- No FFmpeg worker, Redis/BullMQ queue, malware scanner, asynchronous moderation, transcoding, adaptive bitrate rendition, captions, or production SLA is implemented or guaranteed.
- Signed URLs are bearer access until their five-minute expiry. Provider/CDN invalidation is not instantaneous; deletion blocks new LearnSphere grants immediately but cannot promise that an already issued URL or cached copy vanishes instantly.
- The API currently proxies uploads through the application process. Limits bound each request, but deployment ingress, concurrent upload limits, timeouts, and egress costs still need production capacity controls.
