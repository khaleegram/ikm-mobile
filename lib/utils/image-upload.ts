// Media upload utility — Cloudflare R2 via chatcart-api presigned URLs
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { mediaApi } from '@/lib/api/media-api';
import { inferFileExtension } from './market-media';
import {
  prepareAudioForUpload,
  prepareImageForUpload,
  prepareVideoForUpload,
} from './media-compress';

const loadDocumentPicker = async () => {
  try {
    const DocumentPicker = await import('expo-document-picker');
    if (!DocumentPicker || typeof DocumentPicker.getDocumentAsync !== 'function') {
      throw new Error('Document picker module is not properly initialized. Please rebuild your development build.');
    }
    return DocumentPicker;
  } catch (error: any) {
    if (
      error?.message?.includes('native module') ||
      error?.message?.includes('ExpoDocumentPicker') ||
      error?.message?.includes('Cannot find native module')
    ) {
      throw new Error('Document picker native module not found. Please rebuild your development build.');
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

export async function requestImagePermissions(): Promise<boolean> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return status === 'granted';
}

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

async function ensureUploadableFileUri(uri: string, fallbackExtension: string): Promise<string> {
  if (uri.startsWith('file://')) {
    return uri;
  }

  const extension = inferFileExtension(uri, fallbackExtension);
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) {
    return uri;
  }

  const destination = `${cacheDir}upload_${Date.now()}.${extension}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return destination;
}

async function cleanupTemporaryUploadUri(originalUri: string, uploadUri: string): Promise<void> {
  if (uploadUri === originalUri) return;
  await FileSystem.deleteAsync(uploadUri, { idempotent: true }).catch(() => undefined);
}

async function getLocalFileByteLength(uri: string): Promise<number | undefined> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && typeof info.size === 'number' && info.size > 0) {
      return info.size;
    }
  } catch {
    // Ignore and let the upload proceed without Content-Length.
  }
  return undefined;
}

async function uploadPreparedFile(
  preparedUri: string,
  storagePath: string,
  contentType: string,
  fallbackExtension: string,
  onProgress?: (progress: number) => void,
): Promise<{ url: string; path: string }> {
  const uploadUri = await ensureUploadableFileUri(preparedUri, fallbackExtension);
  const contentLength = await getLocalFileByteLength(uploadUri);

  try {
    const presign = await mediaApi.presignUpload({
      path: storagePath,
      contentType,
      contentLength,
    });

    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      const uploadTask = FileSystem.createUploadTask(
        presign.uploadUrl,
        uploadUri,
        {
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          httpMethod: 'PUT',
          headers: {
            'Content-Type': contentType,
          },
        },
        (progress) => {
          if (progress.totalBytesExpectedToSend > 0) {
            onProgress?.(progress.totalBytesSent / progress.totalBytesExpectedToSend);
          }
        },
      );

      const result = await uploadTask.uploadAsync();
      if (!result || result.status < 200 || result.status >= 300) {
        throw new Error(`Upload failed with status ${result?.status ?? 'unknown'}`);
      }
    } else {
      const response = await fetch(preparedUri);
      const blob = await response.blob();
      const putResponse = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: blob,
      });
      if (!putResponse.ok) {
        throw new Error(`Upload failed with status ${putResponse.status}`);
      }
      onProgress?.(1);
    }

    return {
      url: presign.publicUrl,
      path: presign.path,
    };
  } finally {
    await cleanupTemporaryUploadUri(preparedUri, uploadUri);
  }
}

export async function uploadImage(
  uri: string,
  path: string
): Promise<ImageUploadResult> {
  const prepared = await prepareImageForUpload(uri);
  try {
    const result = await uploadPreparedFile(
      prepared.uri,
      path,
      prepared.contentType,
      inferFileExtension(path, 'jpg'),
    );
    return result;
  } finally {
    await prepared.cleanup();
  }
}

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

export async function pickVideo(): Promise<string | null> {
  const hasPermission = await requestImagePermissions();
  if (!hasPermission) {
    throw new Error('Permission to access media library is required');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    allowsEditing: true,
    quality: 0.8,
    videoMaxDuration: 300,
  });

  if (result.canceled) {
    return null;
  }

  return result.assets[0].uri;
}

export async function pickAudio(): Promise<string | null> {
  try {
    const picker = await loadDocumentPicker();
    if (!picker || typeof picker.getDocumentAsync !== 'function') {
      throw new Error('Document picker is not available. Please rebuild your development build.');
    }

    const result = await picker.getDocumentAsync({
      type: ['audio/*'],
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    return result.assets[0].uri;
  } catch (error: any) {
    const errorMessage = error?.message || 'Failed to pick audio file';
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

export async function uploadVideo(
  uri: string,
  path: string,
  onProgress?: (progress: number) => void,
): Promise<MediaUploadResult> {
  const prepared = await prepareVideoForUpload(uri);
  try {
    const result = await uploadPreparedFile(
      prepared.uri,
      path,
      prepared.contentType,
      'mp4',
      onProgress,
    );
    return { ...result, type: 'video' };
  } finally {
    await prepared.cleanup();
  }
}

export async function uploadAudio(
  uri: string,
  path: string
): Promise<MediaUploadResult> {
  const prepared = await prepareAudioForUpload(uri);
  try {
    const result = await uploadPreparedFile(
      prepared.uri,
      path,
      prepared.contentType,
      'm4a',
    );
    return { ...result, type: 'audio' };
  } finally {
    await prepared.cleanup();
  }
}

export async function deleteImage(path: string): Promise<void> {
  await mediaApi.deletePaths([path]);
}

export async function deleteMedia(path: string): Promise<void> {
  await mediaApi.deletePaths([path]);
}
