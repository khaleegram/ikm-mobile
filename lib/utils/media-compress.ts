import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'react-native';
import { inferFileExtension } from './market-media';

const MAX_IMAGE_WIDTH = 1080;
const IMAGE_JPEG_QUALITY = 0.82;

async function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error)
    );
  });
}

export async function prepareImageForUpload(uri: string): Promise<{
  uri: string;
  contentType: string;
  cleanup: () => Promise<void>;
}> {
  const extension = inferFileExtension(uri, 'jpg');
  const isPng = extension === 'png';
  const contentType = isPng ? 'image/png' : 'image/jpeg';

  try {
    const ImageManipulator = await import('expo-image-manipulator');
    const { width, height } = await getImageSize(uri);
    const actions =
      width > MAX_IMAGE_WIDTH
        ? [{ resize: { width: MAX_IMAGE_WIDTH } }]
        : [];

    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      actions,
      {
        compress: IMAGE_JPEG_QUALITY,
        format: isPng
          ? ImageManipulator.SaveFormat.PNG
          : ImageManipulator.SaveFormat.JPEG,
      }
    );

    return {
      uri: manipulated.uri,
      contentType,
      cleanup: async () => {
        if (manipulated.uri !== uri) {
          await FileSystem.deleteAsync(manipulated.uri, { idempotent: true }).catch(() => undefined);
        }
      },
    };
  } catch (error) {
    console.warn('Image compression unavailable, uploading original:', error);
    return {
      uri,
      contentType,
      cleanup: async () => undefined,
    };
  }
}

export async function prepareVideoForUpload(uri: string): Promise<{
  uri: string;
  contentType: string;
  cleanup: () => Promise<void>;
}> {
  const extension = inferFileExtension(uri, 'mp4');
  const contentType =
    extension === 'mov'
      ? 'video/quicktime'
      : extension === 'webm'
        ? 'video/webm'
        : 'video/mp4';

  return {
    uri,
    contentType,
    cleanup: async () => undefined,
  };
}

export async function prepareAudioForUpload(uri: string): Promise<{
  uri: string;
  contentType: string;
  cleanup: () => Promise<void>;
}> {
  const extension = inferFileExtension(uri, 'm4a');
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
  };

  return {
    uri,
    contentType: map[extension] || 'audio/mpeg',
    cleanup: async () => undefined,
  };
}
