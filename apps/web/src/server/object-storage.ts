import {
  CreateBucketCommand,
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

let storageConfig: StorageConfig | null = null;
let bucketReady: Promise<void> | null = null;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Thiếu biến môi trường ${name}.`);
  }
  return value;
}

function getStorageConfig(): StorageConfig {
  if (storageConfig) return storageConfig;

  const endpoint = requiredEnvironment("S3_ENDPOINT");
  const region = process.env.S3_REGION ?? "us-east-1";
  storageConfig = {
    bucket: requiredEnvironment("S3_BUCKET"),
    autoCreateBucket: process.env.S3_AUTO_CREATE_BUCKET === "true",
    client: new S3Client({
      endpoint,
      region,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: requiredEnvironment("S3_ACCESS_KEY"),
        secretAccessKey: requiredEnvironment("S3_SECRET_KEY"),
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
