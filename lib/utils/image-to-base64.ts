// Utility to convert image URI to base64 for Cloud Functions
// Using legacy API to avoid deprecation warnings in Expo SDK 54
import * as FileSystem from 'expo-file-system/legacy';

export interface ImageBase64Result {
  base64: string;
  mimeType: string;
}

/**
 * Convert image URI to base64 string for Cloud Functions
 * @param imageUri - Local file URI (file:// or asset://)
 * @returns Base64 string with data URI prefix
 */
export async function convertImageToBase64(imageUri: string): Promise<string> {
  try {
    // Read file as base64 - expo-file-system accepts 'base64' as string
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: 'base64',
    } as any);

    // Determine MIME type from URI
    let mimeType = 'image/jpeg';
    if (imageUri.toLowerCase().endsWith('.png')) {
      mimeType = 'image/png';
    } else if (imageUri.toLowerCase().endsWith('.webp')) {
      mimeType = 'image/webp';
    }

    // Return data URI format
    return `data:${mimeType};base64,${base64}`;
  } catch (error: any) {
    console.error('Error converting image to base64:', error);
    throw new Error(`Failed to convert image: ${error.message}`);
  }
}

/**
 * Convert multiple images to base64
 */
export async function convertImagesToBase64(imageUris: string[]): Promise<string[]> {
  return Promise.all(imageUris.map(uri => convertImageToBase64(uri)));
}

/**
 * Convert video URI to base64 string for Cloud Functions
 * @param videoUri - Local file URI (file:// or asset://)
 * @returns Base64 string with data URI prefix
 */
export async function convertVideoToBase64(videoUri: string): Promise<string> {
  try {
    const base64 = await FileSystem.readAsStringAsync(videoUri, {
      encoding: 'base64',
    } as any);

    // Determine MIME type from URI
    let mimeType = 'video/mp4';
    if (videoUri.toLowerCase().endsWith('.mov')) {
      mimeType = 'video/quicktime';
    } else if (videoUri.toLowerCase().endsWith('.webm')) {
      mimeType = 'video/webm';
    }

    return `data:${mimeType};base64,${base64}`;
  } catch (error: any) {
    console.error('Error converting video to base64:', error);
    throw new Error(`Failed to convert video: ${error.message}`);
  }
}

/**
 * Convert audio URI to base64 string for Cloud Functions
 * @param audioUri - Local file URI (file:// or asset://)
 * @returns Base64 string with data URI prefix
 */
export async function convertAudioToBase64(audioUri: string): Promise<string> {
  try {
    const base64 = await FileSystem.readAsStringAsync(audioUri, {
      encoding: 'base64',
    } as any);

    // Determine MIME type from URI
    let mimeType = 'audio/mpeg';
    if (audioUri.toLowerCase().endsWith('.wav')) {
      mimeType = 'audio/wav';
    } else if (audioUri.toLowerCase().endsWith('.m4a')) {
      mimeType = 'audio/mp4';
    } else if (audioUri.toLowerCase().endsWith('.ogg')) {
      mimeType = 'audio/ogg';
    }

    return `data:${mimeType};base64,${base64}`;
  } catch (error: any) {
    console.error('Error converting audio to base64:', error);
    throw new Error(`Failed to convert audio: ${error.message}`);
  }
}

