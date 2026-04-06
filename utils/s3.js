/**
 * Cloudflare R2 storage (S3-compatible API).
 * Configure: R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET
 * Optional: R2_ACCOUNT_ID — used to build endpoint if R2_ENDPOINT is omitted.
 */
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
require('dotenv').config();

const R2_BUCKET = process.env.R2_BUCKET;
const R2_ENDPOINT =
  process.env.R2_ENDPOINT ||
  (process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : null);

const requiredEnvVars = ['R2_ACCESS_KEY', 'R2_SECRET_KEY', 'R2_BUCKET'];
const missingCore = requiredEnvVars.filter((k) => !process.env[k]);
const missingEndpoint = !R2_ENDPOINT;

if (missingCore.length > 0 || missingEndpoint) {
  console.error('Missing required R2 environment variables:', [
    ...missingCore,
    ...(missingEndpoint ? ['R2_ENDPOINT (or R2_ACCOUNT_ID)'] : []),
  ]);
  process.exit(1);
}

const r2ClientConfig = {
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
};

/** @type {import('@aws-sdk/client-s3').S3Client} */
const s3Client = new S3Client(r2ClientConfig);

function buildRegionalR2Client(_region) {
  return new S3Client(r2ClientConfig);
}

/**
 * Resolve bucket + object key from a stored URL (R2 presigned, R2 path-style, legacy S3, or raw key).
 */
function parseBucketAndKeyFromUrl(audioUrl, defaultBucket) {
  const bucket = defaultBucket || R2_BUCKET;
  if (!audioUrl || typeof audioUrl !== 'string') {
    return { bucket, key: '' };
  }
  const trimmed = audioUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return { bucket, key: trimmed };
  }
  try {
    const u = new URL(trimmed);
    const path = decodeURIComponent(u.pathname.replace(/^\//, ''));
    const host = String(u.hostname || '').toLowerCase();

    if (host.includes('r2.cloudflarestorage.com')) {
      const slash = path.indexOf('/');
      if (slash === -1) {
        return { bucket: path || bucket, key: '' };
      }
      return { bucket: path.slice(0, slash), key: path.slice(slash + 1) };
    }

    if (host.includes('.s3')) {
      const bucketFromHost = host.split('.s3')[0];
      return { bucket: bucketFromHost || bucket, key: path };
    }

    return { bucket, key: path };
  } catch (_) {
    return { bucket, key: trimmed };
  }
}

/**
 * Stream helper for call audio proxies — uses R2 client.
 */
async function getObjectForAudioProxy(audioUrl) {
  const { bucket, key } = parseBucketAndKeyFromUrl(audioUrl, R2_BUCKET);
  if (!key) {
    throw new Error('Could not resolve object key from audio URL');
  }
  return s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
}

// Generate presigned URL for uploading
const putobject = async (key, contentType) => {
  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 604800 });
    return signedUrl;
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    throw error;
  }
};

// Generate presigned URL for getting/reading an object
const getobject = async (key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ResponseContentDisposition: 'inline',
      ResponseContentType: key.endsWith('.txt') ? 'text/plain; charset=utf-8' : undefined,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 604800 });
    return signedUrl;
  } catch (error) {
    console.error('Error generating get presigned URL:', error);
    throw error;
  }
};

// Generate presigned URL for a specific bucket and key
const getobjectFor = async (bucket, key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: 'inline',
      ResponseContentType: key.endsWith('.txt') ? 'text/plain; charset=utf-8' : undefined,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 604800 });
    return signedUrl;
  } catch (error) {
    console.error('Error generating get presigned URL for bucket:', error);
    throw error;
  }
};

// Same R2 endpoint; region argument ignored (kept for API compatibility)
const getobjectForWithRegion = async (bucket, key, _region) => {
  try {
    const client = buildRegionalR2Client(_region);
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: 'inline',
      ResponseContentType: key.endsWith('.txt') ? 'text/plain; charset=utf-8' : undefined,
    });
    const signedUrl = await getSignedUrl(client, command, { expiresIn: 604800 });
    return signedUrl;
  } catch (error) {
    console.error('Error generating regional presigned URL:', error);
    throw error;
  }
};

const deleteObject = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error('Error deleting object:', error);
    throw error;
  }
};

/** Server-side upload (e.g. multipart form) — same bucket as presigned flows */
const uploadBuffer = async (key, buffer, contentType) => {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
  });
  await s3Client.send(command);
  return key;
};

module.exports = {
  s3Client,
  putobject,
  getobject,
  getobjectFor,
  getobjectForWithRegion,
  deleteObject,
  uploadBuffer,
  getObjectForAudioProxy,
  parseBucketAndKeyFromUrl,
  R2_BUCKET,
};
