// Media upload utility for Firebase Storage (images, video, audio)
import * as ImagePicker from 'expo-image-picker';
import { getDownloadURL, ref, uploadBytes, uploadBytesResumable } from 'firebase/storage';
import { storage } from '../firebase/config';
import Constants from 'expo-constants';

// Lazy load DocumentPicker
// Note: After installing expo-document-picker, you need to rebuild your development build
const loadDocumentPicker = async () => {
  try {
    // Direct import - should work in development builds
    const DocumentPicker = await import('expo-document-picker');
    
    // Check if the module has the required method
    if (!DocumentPicker || typeof DocumentPicker.getDocumentAsync !== 'function') {
      throw new Error('Document picker module is not properly initialized. Please rebuild your development build.');
    }
    
    return DocumentPicker;
  } catch (error: any) {
    // Handle native module errors - usually means the dev build needs to be rebuilt
    if (
      error?.message?.includes('native module') ||
      error?.message?.includes('ExpoDocumentPicker') ||
      error?.message?.includes('Cannot find native module')
    ) {
      throw new Error('Document picker native module not found. Please rebuild your development build with: npx expo prebuild --clean && npx expo run:android (or run:ios)');
    }
    throw error;
  }
};

export interface ImageUploadResult {
  url: string;
  path: string;
}

export interface MediaUploadResult {
  url: string;
  path: string;
  type: 'image' | 'video' | 'audio';
}

/**
 * Request image picker permissions
 */
export async function requestImagePermissions(): Promise<boolean> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return status === 'granted';
}

/**
 * Pick an image from the device
 */
export async function pickImage(): Promise<string | null> {
  const hasPermission = await requestImagePermissions();
  if (!hasPermission) {
    throw new Error('Permission to access media library is required');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [4, 3],
    quality: 0.8,
  });

  if (result.canceled) {
    return null;
  }

  return result.assets[0].uri;
}

/**
 * Pick multiple images from the device
 */
export async function pickMultipleImages(maxImages: number = 5): Promise<string[]> {
  const hasPermission = await requestImagePermissions();
  if (!hasPermission) {
    throw new Error('Permission to access media library is required');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: true,
    allowsEditing: true,
    aspect: [4, 3],
    quality: 0.8,
    selectionLimit: maxImages,
  });

  if (result.canceled) {
    return [];
  }

  return result.assets.map((asset) => asset.uri);
}

/**
 * Upload image to Firebase Storage
 */
export async function uploadImage(
  uri: string,
  path: string
): Promise<ImageUploadResult> {
  try {
    // Fetch the image
    const response = await fetch(uri);
    const blob = await response.blob();

    // Upload to Firebase Storage
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, blob);

    // Get download URL
    const downloadURL = await getDownloadURL(storageRef);

    return {
      url: downloadURL,
      path,
    };
  } catch (error) {
    console.error('Error uploading image:', error);
    throw new Error('Failed to upload image');
  }
}

/**
 * Upload multiple images to Firebase Storage
 */
export async function uploadImages(
  uris: string[],
  basePath: string,
  userId: string
): Promise<string[]> {
  const uploadPromises = uris.map(async (uri, index) => {
    const filename = `image_${Date.now()}_${index}.jpg`;
    const path = `${basePath}/${userId}/${filename}`;
    const result = await uploadImage(uri, path);
    return result.url;
  });

  return Promise.all(uploadPromises);
}

/**
 * Pick a video from the device
 */
export async function pickVideo(): Promise<string | null> {
  const hasPermission = await requestImagePermissions();
  if (!hasPermission) {
    throw new Error('Permission to access media library is required');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    allowsEditing: true,
    quality: 0.8,
    videoMaxDuration: 300, // 5 minutes max
  });

  if (result.canceled) {
    return null;
  }

  return result.assets[0].uri;
}

/**
 * Pick an audio file from the device
 * Note: Requires the development build to be rebuilt after installing expo-document-picker
 */
export async function pickAudio(): Promise<string | null> {
  try {
    const picker = await loadDocumentPicker();
    
    // Double-check that getDocumentAsync exists
    if (!picker || typeof picker.getDocumentAsync !== 'function') {
      throw new Error('Document picker is not available. Please rebuild your development build.');
    }
    
    const result = await picker.getDocumentAsync({
      type: ['audio/*'],
      copyToCacheDirectory: true,
    });

    if (result.canceled) {
      return null;
    }

    if (!result.assets || result.assets.length === 0) {
      return null;
    }

    return result.assets[0].uri;
  } catch (error: any) {
    const errorMessage = error?.message || 'Failed to pick audio file';
    
    // Check for native module errors - means dev build needs to be rebuilt
    if (
      errorMessage.includes('native module') ||
      errorMessage.includes('ExpoDocumentPicker') ||
      errorMessage.includes('Cannot find native module') ||
      errorMessage.includes('rebuild')
    ) {
      throw new Error('Document picker native module not found. Please rebuild your development build.');
    }
    
    throw new Error(errorMessage);
  }
}

/**
 * Upload video to Firebase Storage with real-time progress reporting.
 * Uses uploadBytesResumable so large files stream instead of buffering.
 */
export async function uploadVideo(
  uri: string,
  path: string,
  onProgress?: (progress: number) => void,
): Promise<MediaUploadResult> {
  try {
    const response = await fetch(uri);
    const blob = await response.blob();

    // Derive content-type from blob; fall back to video/mp4 so the
    // Storage rules never reject on application/octet-stream.
    const contentType = blob.type && blob.type !== 'application/octet-stream'
      ? blob.type
      : 'video/mp4';

    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, blob, { contentType });

    await new Promise<void>((resolve, reject) => {
      task.on(
        'state_changed',
        (snapshot) => {
          if (snapshot.totalBytes > 0) {
            onProgress?.(snapshot.bytesTransferred / snapshot.totalBytes);
          }
        },
        reject,
        resolve,
      );
    });

    const downloadURL = await getDownloadURL(task.snapshot.ref);
    return { url: downloadURL, path, type: 'video' };
  } catch (error) {
    console.error('Error uploading video:', error);
    throw new Error('Failed to upload video');
  }
}

/**
 * Upload audio to Firebase Storage
 */
export async function uploadAudio(
  uri: string,
  path: string
): Promise<MediaUploadResult> {
  try {
    // Fetch the audio file
    const response = await fetch(uri);
    const blob = await response.blob();

    // Upload to Firebase Storage
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, blob);

    // Get download URL
    const downloadURL = await getDownloadURL(storageRef);

    return {
      url: downloadURL,
      path,
      type: 'audio',
    };
  } catch (error) {
    console.error('Error uploading audio:', error);
    throw new Error('Failed to upload audio');
  }
}

/**
 * Delete image from Firebase Storage
 */
export async function deleteImage(path: string): Promise<void> {
  try {
    const { deleteObject } = await import('firebase/storage');
    const storageRef = ref(storage, path);
    await deleteObject(storageRef);
  } catch (error) {
    console.error('Error deleting image:', error);
    throw new Error('Failed to delete image');
  }
}

/**
 * Delete media file from Firebase Storage
 */
export async function deleteMedia(path: string): Promise<void> {
  try {
    const { deleteObject } = await import('firebase/storage');
    const storageRef = ref(storage, path);
    await deleteObject(storageRef);
  } catch (error) {
    console.error('Error deleting media:', error);
    throw new Error('Failed to delete media file');
  }
}

