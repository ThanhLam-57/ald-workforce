import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { putPrivateObject, resolveObjectStorageEnvironment } from "./object-storage";

const STORAGE_ENVIRONMENT_NAMES = [
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_PROJECT_ID",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_FORCE_PATH_STYLE",
  "S3_AUTO_CREATE_BUCKET",
  "AWS_ENDPOINT_URL",
  "AWS_DEFAULT_REGION",
  "AWS_S3_BUCKET_NAME",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_S3_URL_STYLE",
] as const;

const originalEnvironment = Object.fromEntries(
  STORAGE_ENVIRONMENT_NAMES.map((name) => [name, process.env[name]]),
) as Readonly<Record<(typeof STORAGE_ENVIRONMENT_NAMES)[number], string | undefined>>;

function clearStorageEnvironment(): void {
  for (const name of STORAGE_ENVIRONMENT_NAMES) {
    delete process.env[name];
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  clearStorageEnvironment();
  for (const name of STORAGE_ENVIRONMENT_NAMES) {
    const value = originalEnvironment[name];
    if (value !== undefined) process.env[name] = value;
  }
});

describe("resolveObjectStorageEnvironment", () => {
  it("ưu tiên S3_* ở local để giữ cấu hình MinIO hiện tại", () => {
    const result = resolveObjectStorageEnvironment({
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: "local-private",
      S3_ACCESS_KEY: "local-access",
      S3_SECRET_KEY: "local-secret",
      S3_FORCE_PATH_STYLE: "true",
      S3_AUTO_CREATE_BUCKET: "true",
      AWS_ENDPOINT_URL: "https://storage.railway.app",
      AWS_DEFAULT_REGION: "auto",
      AWS_S3_BUCKET_NAME: "railway-private",
      AWS_ACCESS_KEY_ID: "railway-access",
      AWS_SECRET_ACCESS_KEY: "railway-secret",
      AWS_S3_URL_STYLE: "virtual",
    });

    expect(result).toEqual({
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      bucket: "local-private",
      accessKeyId: "local-access",
      secretAccessKey: "local-secret",
      forcePathStyle: true,
      autoCreateBucket: true,
    });
  });

  it("ưu tiên biến AWS_* được Railway tự cấp khi chạy trên Railway", () => {
    const result = resolveObjectStorageEnvironment({
      RAILWAY_ENVIRONMENT_ID: "production",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: "stale-local-bucket",
      S3_ACCESS_KEY: "stale-local-access",
      S3_SECRET_KEY: "stale-local-secret",
      S3_FORCE_PATH_STYLE: "true",
      S3_AUTO_CREATE_BUCKET: "true",
      AWS_ENDPOINT_URL: "https://storage.railway.app",
      AWS_DEFAULT_REGION: "auto",
      AWS_S3_BUCKET_NAME: "ald-private-abc123",
      AWS_ACCESS_KEY_ID: "railway-access",
      AWS_SECRET_ACCESS_KEY: "railway-secret",
      AWS_S3_URL_STYLE: "virtual",
    });

    expect(result).toEqual({
      endpoint: "https://storage.railway.app",
      region: "auto",
      bucket: "ald-private-abc123",
      accessKeyId: "railway-access",
      secretAccessKey: "railway-secret",
      forcePathStyle: false,
      autoCreateBucket: false,
    });
  });

  it("vẫn dùng S3_* trên Railway khi chưa có bộ AWS_* tự cấp", () => {
    const result = resolveObjectStorageEnvironment({
      RAILWAY_PROJECT_ID: "project",
      S3_ENDPOINT: "https://s3.example.test",
      S3_BUCKET: "private",
      S3_ACCESS_KEY: "access",
      S3_SECRET_KEY: "secret",
      S3_FORCE_PATH_STYLE: "false",
    });

    expect(result).toMatchObject({
      endpoint: "https://s3.example.test",
      region: "us-east-1",
      bucket: "private",
      accessKeyId: "access",
      secretAccessKey: "secret",
      forcePathStyle: false,
    });
  });

  it("chuyển AWS_S3_URL_STYLE=path thành forcePathStyle", () => {
    const result = resolveObjectStorageEnvironment({
      AWS_ENDPOINT_URL: "https://storage.example.test",
      AWS_S3_BUCKET_NAME: "private",
      AWS_ACCESS_KEY_ID: "access",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_S3_URL_STYLE: "path",
    });

    expect(result.forcePathStyle).toBe(true);
  });

  it("báo rõ hai bộ biến được hỗ trợ khi thiếu cấu hình bắt buộc", () => {
    expect(() => resolveObjectStorageEnvironment({})).toThrow(
      "Thiếu cấu hình object storage đầy đủ: bộ S3_* hoặc bộ AWS_*.",
    );
  });
});

describe("putPrivateObject", () => {
  it("giữ sha256 trong metadata nhưng không gửi ChecksumSHA256 tới provider", async () => {
    clearStorageEnvironment();
    process.env.S3_ENDPOINT = "https://storage.example.test";
    process.env.S3_REGION = "us-east-1";
    process.env.S3_BUCKET = "private";
    process.env.S3_ACCESS_KEY = "access";
    process.env.S3_SECRET_KEY = "secret";
    process.env.S3_FORCE_PATH_STYLE = "false";
    process.env.S3_AUTO_CREATE_BUCKET = "false";

    let sentCommand: unknown;
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      sentCommand = command;
      return {} as never;
    });

    const body = new Uint8Array([1, 2, 3, 4]);
    await putPrivateObject({
      objectKey: "imports/attendance/test.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body,
      checksumSha256: "base64-sha256",
    });

    expect(sentCommand).toBeInstanceOf(PutObjectCommand);
    const input = (sentCommand as PutObjectCommand).input;
    expect(input).toMatchObject({
      Bucket: "private",
      Key: "imports/attendance/test.xlsx",
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ContentLength: 4,
      Body: body,
      Metadata: { sha256: "base64-sha256" },
    });
    expect(input).not.toHaveProperty("ChecksumSHA256");
  });
});
