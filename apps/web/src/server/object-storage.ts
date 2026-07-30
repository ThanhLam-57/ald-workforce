import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type StorageConfig = Readonly<{
  bucket: string;
  client: S3Client;
  autoCreateBucket: boolean;
}>;

export type ObjectStorageEnvironment = Readonly<Record<string, string | undefined>>;

export type ResolvedObjectStorageEnvironment = Readonly<{
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  autoCreateBucket: boolean;
}>;

let storageConfig: StorageConfig | null = null;
let bucketReady: Promise<void> | null = null;

function environmentValue(environment: ObjectStorageEnvironment, name: string): string | null {
  const value = environment[name]?.trim();
  return value ? value : null;
}

function requiredEnvironment(
  environment: ObjectStorageEnvironment,
  names: readonly string[],
): string {
  for (const name of names) {
    const value = environmentValue(environment, name);
    if (value) return value;
  }

  throw new Error(`Thiếu biến môi trường ${names.join(" hoặc ")}.`);
}

function optionalEnvironment(
  environment: ObjectStorageEnvironment,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = environmentValue(environment, name);
    if (value) return value;
  }
  return null;
}

function railwayEnvironment(environment: ObjectStorageEnvironment): boolean {
  return Boolean(
    environmentValue(environment, "RAILWAY_ENVIRONMENT_ID") ??
      environmentValue(environment, "RAILWAY_PROJECT_ID"),
  );
}

const APPLICATION_STORAGE_NAMES = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
] as const;
const RAILWAY_STORAGE_NAMES = [
  "AWS_ENDPOINT_URL",
  "AWS_S3_BUCKET_NAME",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
] as const;

type StorageEnvironmentSource = "application" | "railway";

function hasCompleteEnvironment(
  environment: ObjectStorageEnvironment,
  names: readonly string[],
): boolean {
  return names.every((name) => environmentValue(environment, name) !== null);
}

function storageEnvironmentSource(environment: ObjectStorageEnvironment): StorageEnvironmentSource {
  const onRailway = railwayEnvironment(environment);
  const hasRailwayBundle = hasCompleteEnvironment(environment, RAILWAY_STORAGE_NAMES);
  const hasApplicationBundle = hasCompleteEnvironment(environment, APPLICATION_STORAGE_NAMES);

  if (onRailway && hasRailwayBundle) return "railway";
  if (hasApplicationBundle) return "application";
  if (hasRailwayBundle) return "railway";
  throw new Error("Thiếu cấu hình object storage đầy đủ: bộ S3_* hoặc bộ AWS_*.");
}

function resolveForcePathStyle(
  environment: ObjectStorageEnvironment,
  source: StorageEnvironmentSource,
): boolean {
  if (source === "railway") {
    const style = environmentValue(environment, "AWS_S3_URL_STYLE")?.toLowerCase() ?? null;
    return style === "path" || style === "path-style";
  }

  return environmentValue(environment, "S3_FORCE_PATH_STYLE")?.toLowerCase() === "true";
}

export function resolveObjectStorageEnvironment(
  environment: ObjectStorageEnvironment = process.env,
): ResolvedObjectStorageEnvironment {
  const source = storageEnvironmentSource(environment);

  if (source === "railway") {
    return {
      endpoint: requiredEnvironment(environment, ["AWS_ENDPOINT_URL"]),
      region: optionalEnvironment(environment, ["AWS_DEFAULT_REGION"]) ?? "auto",
      bucket: requiredEnvironment(environment, ["AWS_S3_BUCKET_NAME"]),
      accessKeyId: requiredEnvironment(environment, ["AWS_ACCESS_KEY_ID"]),
      secretAccessKey: requiredEnvironment(environment, ["AWS_SECRET_ACCESS_KEY"]),
      forcePathStyle: resolveForcePathStyle(environment, source),
      autoCreateBucket: false,
    };
  }

  return {
    endpoint: requiredEnvironment(environment, ["S3_ENDPOINT"]),
    region: optionalEnvironment(environment, ["S3_REGION"]) ?? "us-east-1",
    bucket: requiredEnvironment(environment, ["S3_BUCKET"]),
    accessKeyId: requiredEnvironment(environment, ["S3_ACCESS_KEY"]),
    secretAccessKey: requiredEnvironment(environment, ["S3_SECRET_KEY"]),
    forcePathStyle: resolveForcePathStyle(environment, source),
    autoCreateBucket: environmentValue(environment, "S3_AUTO_CREATE_BUCKET") === "true",
  };
}

function getStorageConfig(): StorageConfig {
  if (storageConfig) return storageConfig;

  const environment = resolveObjectStorageEnvironment();
  storageConfig = {
    bucket: environment.bucket,
    autoCreateBucket: environment.autoCreateBucket,
    client: new S3Client({
      endpoint: environment.endpoint,
      region: environment.region,
      forcePathStyle: environment.forcePathStyle,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: environment.accessKeyId,
        secretAccessKey: environment.secretAccessKey,
      },
    }),
  };
  return storageConfig;
}

async function ensureBucket(): Promise<void> {
  const config = getStorageConfig();
  if (!config.autoCreateBucket) return;
  if (bucketReady) return bucketReady;

  bucketReady = (async () => {
    try {
      await config.client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    } catch {
      try {
        await config.client.send(new CreateBucketCommand({ Bucket: config.bucket }));
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
          bucketReady = null;
          throw error;
        }
      }
    }
  })();
  return bucketReady;
}

export async function createEvidenceUploadUrl(input: {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}) {
  await ensureBucket();
  const config = getStorageConfig();
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: input.objectKey,
    ContentType: input.mimeType,
    ContentLength: input.sizeBytes,
    ChecksumSHA256: input.checksumSha256,
    Metadata: {
      sha256: input.checksumSha256,
    },
  });
  return {
    url: await getSignedUrl(config.client, command, {
      expiresIn: 300,
      signableHeaders: new Set(["content-type"]),
      unhoistableHeaders: new Set(["x-amz-checksum-sha256", "x-amz-meta-sha256"]),
    }),
    expiresInSeconds: 300,
    headers: {
      "Content-Type": input.mimeType,
      "x-amz-checksum-sha256": input.checksumSha256,
      "x-amz-meta-sha256": input.checksumSha256,
    },
  };
}

export async function createPrivateUploadUrl(input: {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}) {
  return createEvidenceUploadUrl(input);
}

export async function verifyEvidenceObject(input: {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}): Promise<void> {
  const config = getStorageConfig();
  const result = await config.client.send(
    new HeadObjectCommand({
      Bucket: config.bucket,
      Key: input.objectKey,
    }),
  );
  const contentType = result.ContentType?.split(";")[0]?.trim().toLowerCase();
  if (
    result.ContentLength !== input.sizeBytes ||
    contentType !== input.mimeType ||
    result.Metadata?.sha256 !== input.checksumSha256
  ) {
    throw new Error("Metadata evidence trên object storage không khớp yêu cầu đã ký.");
  }
}

export async function verifyPrivateObject(input: {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}): Promise<void> {
  return verifyEvidenceObject(input);
}

export async function readPrivateObject(objectKey: string): Promise<Uint8Array> {
  const config = getStorageConfig();
  const result = await config.client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
    }),
  );
  if (!result.Body) throw new Error("Private object không có nội dung.");
  return result.Body.transformToByteArray();
}

export async function putPrivateObject(input: {
  objectKey: string;
  mimeType: string;
  body: Uint8Array;
  checksumSha256?: string;
}): Promise<void> {
  await ensureBucket();
  const config = getStorageConfig();
  await config.client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.objectKey,
      ContentType: input.mimeType,
      ContentLength: input.body.byteLength,
      Body: input.body,
      ...(input.checksumSha256
        ? {
            Metadata: { sha256: input.checksumSha256 },
          }
        : {}),
    }),
  );
}

export async function deletePrivateObject(objectKey: string): Promise<void> {
  const config = getStorageConfig();
  await config.client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
    }),
  );
}

export async function createEvidenceViewUrl(input: {
  objectKey: string;
  originalFileName: string;
  mimeType: string;
}) {
  const config = getStorageConfig();
  const safeFileName = input.originalFileName.replace(/["\r\n]/g, "_");
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: input.objectKey,
    ResponseContentType: input.mimeType,
    ResponseContentDisposition: `inline; filename="${safeFileName}"`,
  });
  return {
    url: await getSignedUrl(config.client, command, { expiresIn: 60 }),
    expiresInSeconds: 60,
  };
}

export async function createPrivateDownloadUrl(input: {
  objectKey: string;
  fileName: string;
  mimeType: string;
}) {
  const config = getStorageConfig();
  const safeFileName = input.fileName.replace(/["\r\n]/g, "_");
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: input.objectKey,
    ResponseContentType: input.mimeType,
    ResponseContentDisposition: `attachment; filename="${safeFileName}"`,
  });
  return {
    url: await getSignedUrl(config.client, command, { expiresIn: 60 }),
    expiresInSeconds: 60,
  };
}
