import cloudinary from 'cloudinary';
const v2 = (cloudinary as any).v2 || cloudinary;

import { log } from './index.js';

// Configuration
v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads an image to Cloudinary from a buffer
 */
export async function uploadImage(fileBuffer: Buffer, folder: string = 'omar_project'): Promise<string> {
  return new Promise((resolve, reject) => {
    const uploadStream = v2.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
      },
      (error: any, result: any) => {
        if (error) {
          log(`[Cloudinary] Error uploading image: ${error.message}`);
          return reject(error);
        }
        if (!result) {
          return reject(new Error('Cloudinary upload result is undefined'));
        }
        log(`[Cloudinary] Image uploaded successfully: ${result.secure_url}`);
        resolve(result.secure_url);
      }
    );

    uploadStream.end(fileBuffer);
  });
}

/**
 * Deletes an image from Cloudinary given its public_id or secure_url
 */
export async function deleteImage(imageUrl: string): Promise<void> {
  try {
    // Extract public_id from secure_url if necessary
    // Example: https://res.cloudinary.com/cloud_name/image/upload/v12345/folder/public_id.jpg
    const parts = imageUrl.split('/');
    const lastPart = parts[parts.length - 1];
    const folderPart = parts[parts.length - 2];
    const publicId = `${folderPart}/${lastPart.split('.')[0]}`;

    await v2.uploader.destroy(publicId);
    log(`[Cloudinary] Image deleted successfully: ${publicId}`);
  } catch (error: any) {
    log(`[Cloudinary] Error deleting image: ${error.message}`);
  }
}
