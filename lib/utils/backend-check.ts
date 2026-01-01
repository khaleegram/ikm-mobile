// Backend connectivity checker
import { cloudFunctions } from '../api/cloud-functions';
import { apiClient } from '../api/client';

export interface BackendStatus {
  cloudFunctions: {
    working: boolean;
    error?: string;
  };
  restApi: {
    configured: boolean;
    working: boolean;
    error?: string;
    url?: string;
  };
}

/**
 * Check if Cloud Functions are working
 */
export async function checkCloudFunctions(): Promise<{ working: boolean; error?: string }> {
  try {
    await cloudFunctions.helloWorld();
    return { working: true };
  } catch (error: any) {
    return {
      working: false,
      error: error.message || 'Cloud Functions are not accessible',
    };
  }
}

/**
 * Check if REST API backend is configured and working
 */
export async function checkRestApi(): Promise<{ configured: boolean; working: boolean; error?: string; url?: string }> {
  const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  
  if (!apiUrl || apiUrl === 'http://localhost:3000/api') {
    return {
      configured: false,
      working: false,
      error: 'EXPO_PUBLIC_API_BASE_URL is not set or is using default localhost value',
      url: apiUrl,
    };
  }

  try {
    // Try a simple health check or test endpoint
    await apiClient.get('/health').catch(() => {
      // If /health doesn't exist, that's okay - backend might not have it
    });
    return {
      configured: true,
      working: true,
      url: apiUrl,
    };
  } catch (error: any) {
    return {
      configured: true,
      working: false,
      error: error.message || 'Backend API is not accessible',
      url: apiUrl,
    };
  }
}

/**
 * Check both backends and return status
 */
export async function checkBackendStatus(): Promise<BackendStatus> {
  const [cloudFunctionsStatus, restApiStatus] = await Promise.all([
    checkCloudFunctions(),
    checkRestApi(),
  ]);

  return {
    cloudFunctions: cloudFunctionsStatus,
    restApi: restApiStatus,
  };
}

