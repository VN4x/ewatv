import { getMistConfig } from "./config.server";

type MegaSignResult = { url: string; expiresInSec: number };

/**
 * Presign Mega.io S3-compatible GET URL for Mist direct-source smoke tests.
 * Requires MEGA_S3_ENDPOINT, MEGA_S3_ACCESS_KEY, MEGA_S3_SECRET_KEY, MEGA_S3_BUCKET.
 */
export async function signMegaObjectKey(
  objectKey: string,
  expiresInSec = 3600,
): Promise<MegaSignResult> {
  const endpoint = process.env.MEGA_S3_ENDPOINT;
  const accessKey = process.env.MEGA_S3_ACCESS_KEY;
  const secretKey = process.env.MEGA_S3_SECRET_KEY;
  const bucket = process.env.MEGA_S3_BUCKET;
  const region = process.env.MEGA_S3_REGION ?? "us-east-1";

  if (!endpoint || !accessKey || !secretKey || !bucket) {
    throw new Error(
      "Mega S3 signing is not configured (MEGA_S3_ENDPOINT, MEGA_S3_ACCESS_KEY, MEGA_S3_SECRET_KEY, MEGA_S3_BUCKET).",
    );
  }

  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });

  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
    { expiresIn: expiresInSec },
  );

  void getMistConfig();
  return { url, expiresInSec };
}

/** Parse mega_s3 source_ref: `bucket/key` or plain `key` (default bucket). */
export function parseMegaSourceRef(sourceRef: string): { bucket: string; key: string } {
  const defaultBucket = process.env.MEGA_S3_BUCKET ?? "";
  if (sourceRef.includes("/")) {
    const [bucket, ...rest] = sourceRef.split("/");
    return { bucket, key: rest.join("/") };
  }
  return { bucket: defaultBucket, key: sourceRef };
}
