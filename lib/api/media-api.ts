import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';

export interface PresignUploadResponse {
  success: boolean;
  uploadUrl: string;
  publicUrl: string;
  path: string;
  contentType: string;
}

export const mediaApi = {
  async presignUpload(input: {
    path: string;
    contentType: string;
    contentLength?: number;
  }): Promise<PresignUploadResponse> {
    return coreCloudClient.request<PresignUploadResponse>(apiUrl('/media/presign'), {
      method: 'POST',
      body: input,
      requiresAuth: true,
    });
  },

  async deletePaths(paths: string[]): Promise<{ success: boolean; deleted: number }> {
    return coreCloudClient.request(apiUrl('/media/delete'), {
      method: 'POST',
      body: { paths },
      requiresAuth: true,
    });
  },

  async processOriginalVideoSound(input: {
    postId: string;
    videoPath: string;
  }): Promise<{ success: boolean; skipped?: boolean; audioUrl?: string }> {
    return coreCloudClient.request(apiUrl('/media/process-video'), {
      method: 'POST',
      body: input,
      requiresAuth: true,
    });
  },
};
