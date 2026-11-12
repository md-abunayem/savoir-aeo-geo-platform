import "../config/load-env.js";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { parseEnvironment } from "../config/env.js";

async function main() {
  const env = parseEnvironment(process.env);
  const bucket = env.S3_PUBLIC_BUCKET;
  if (!bucket || bucket === env.S3_BUCKET || !env.S3_PUBLIC_BASE_URL)
    throw new Error("Configure a separate public bucket and HTTPS URL first");
  const storage = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
  try {
    try {
      await storage.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404)
        throw error;
      await storage.send(
        new CreateBucketCommand({
          Bucket: bucket,
          ...(env.S3_REGION === "us-east-1"
            ? {}
            : { CreateBucketConfiguration: { LocationConstraint: env.S3_REGION as "eu-west-1" } }),
        }),
      );
    }
    await storage.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: "*",
              Action: ["s3:GetObject"],
              Resource: [`arn:aws:s3:::${bucket}/*`],
            },
          ],
        }),
      }),
    );
    await storage.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: env.CORS_ORIGIN,
              AllowedMethods: ["PUT", "GET", "HEAD"],
              AllowedHeaders: ["content-type", "cache-control"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    console.log(
      "Dedicated public media bucket configured. Only object reads are public; private evidence storage is unchanged.",
    );
  } finally {
    storage.destroy();
  }
}
main().catch(() => {
  console.error(
    "Public media setup failed. Check dedicated bucket configuration and storage permissions.",
  );
  process.exitCode = 1;
});
