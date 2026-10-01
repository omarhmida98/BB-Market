import { spawn } from 'child_process';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import path from 'path';
import fs from 'fs';
import { log } from './index.js';

export async function performBackup(): Promise<string> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith('postgres://') && !dbUrl.startsWith('postgresql://'))) {
    throw new Error('DATABASE_URL is not set or not a PostgreSQL connection string');
  }

  const b2KeyId = (process.env.B2_KEY_ID || "").trim();
  const b2AppKey = (process.env.B2_APPLICATION_KEY || "").trim();
  const b2Bucket = (process.env.B2_BUCKET_NAME || "").trim();
  const b2Region = (process.env.B2_REGION || "").trim();

  if (!b2KeyId || !b2AppKey || !b2Bucket || !b2Region) {
    throw new Error('Backblaze B2 configuration is incomplete in environment variables.');
  }

  log(`[B2-CONFIG] Region: ${b2Region}, Bucket: ${b2Bucket}`);
  log(`[B2-CONFIG] KeyID length: ${b2KeyId.length}, AppKey length: ${b2AppKey.length}`);
  log(`[B2-CONFIG] KeyID starts with: ${b2KeyId.substring(0, 3)}..., Ends with: ...${b2KeyId.substring(b2KeyId.length - 3)}`);

  // Create an S3 client configured for Backblaze B2
  const s3Client = new S3Client({
    region: b2Region,
    endpoint: `https://s3.${b2Region}.backblazeb2.com`,
    credentials: {
      accessKeyId: b2KeyId,
      secretAccessKey: b2AppKey,
    },
    forcePathStyle: true, // Recommended for B2
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}.sql`;
  
  // Dump to a temporary file locally before uploading
  const tempPath = path.join(process.cwd(), filename);

  log(`[BACKUP] Starting database backup. Temp file: ${tempPath}`);

  return new Promise((resolve, reject) => {
    // libpq defaults to PGSSLMODE=prefer, which *tries* TLS and then silently falls
    // back to plaintext if the server does not offer it. A whole database dump
    // crossing the network unencrypted would leave no trace in any log, so pin the
    // mode instead of inheriting the default: `require` matches the runtime pool
    // (which uses rejectUnauthorized:false, i.e. encrypt without CA verification),
    // and `disable` is only correct when DATABASE_SSL=false.
    const tlsRequired = process.env.DATABASE_SSL !== 'false';
    const pgSslMode = tlsRequired ? 'require' : 'disable';

    log(`[BACKUP] pg_dump TLS: ${pgSslMode}${tlsRequired ? '' : ' (DATABASE_SSL=false)'}`);

    // Note: This requires pg_dump to be available in the system PATH
    const pgDump = spawn('pg_dump', [dbUrl, '-f', tempPath], {
      env: { ...process.env, PGSSLMODE: pgSslMode },
    });

    pgDump.on('error', (err) => {
      log(`[BACKUP] pg_dump failed to start. Is postgresql-client installed? Error: ${err.message}`);
      reject(new Error(`Failed to start pg_dump: ${err.message}`));
    });

    pgDump.stderr.on('data', (data) => {
      const msg = data.toString();
      // pg_dump writes warnings and notices to stderr
      console.error(`[BACKUP-PGDUMP] ${msg.trim()}`);
    });

    pgDump.on('close', async (code) => {
      if (code !== 0) {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        return reject(new Error(`pg_dump process exited with code ${code}`));
      }

      log(`[BACKUP] pg_dump completed successfully. Uploading to B2 bucket '${b2Bucket}'...`);

      try {
        const fileStream = fs.createReadStream(tempPath);
        
        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: b2Bucket,
            Key: filename,
            Body: fileStream,
          },
        });

        // Uncomment for progress logging
        // upload.on('httpUploadProgress', (progress) => {
        //   log(`[BACKUP] Upload progress: ${progress.loaded} bytes`);
        // });

        await upload.done();
        log(`[BACKUP] Upload completed successfully: ${filename}`);

        // Cleanup local file
        fs.unlinkSync(tempPath);
        
        resolve(filename);
      } catch (err: any) {
        log(`[BACKUP] Error during S3 upload: ${err.message}`);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        reject(err);
      }
    });
  });
}
