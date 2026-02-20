// API client for backend calls
import { getIdToken } from '../firebase/auth/use-user';

const DEFAULT_API_BASE_URL = 'http://localhost:3000/api';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;

let hasWarnedMissingBaseUrl = false;
export interface ApiError {
  message: string;
  code?: string;
  status?: number;
}

class ApiClient {
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    try {
      // Avoid noisy startup warnings: only warn when the REST client is actually used.
      if (!process.env.EXPO_PUBLIC_API_BASE_URL || API_BASE_URL === DEFAULT_API_BASE_URL) {
        if (!hasWarnedMissingBaseUrl) {
          hasWarnedMissingBaseUrl = true;
          console.warn(
            'EXPO_PUBLIC_API_BASE_URL is not set (or using default localhost). ' +
              'REST-backed features will fail until a backend is configured.'
          );
        }
      }

      const token = await getIdToken();
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...options.headers,
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const url = `${API_BASE_URL}${endpoint}`;
      console.log(`[API] ${options.method || 'GET'} ${url}`);

      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response) {
        throw new Error('No response from server. Please check your internet connection and backend URL configuration.');
      }

      // Try to parse JSON response
      let data: any;
      try {
        data = await response.json();
      } catch (parseError) {
        // If JSON parsing fails, get text
        const text = await response.text();
        console.error('[API] Failed to parse JSON:', text);
        if (!response.ok) {
          throw new Error(`Server error (${response.status}): ${response.statusText}`);
        }
        data = text ? JSON.parse(text) : {};
      }

      if (!response.ok) {
        const error: ApiError = {
          message: data.message || data.error || `HTTP ${response.status}: ${response.statusText}`,
          code: data.code,
          status: response.status,
        };
        console.error('[API] Error response:', error);
        throw error;
      }

      return data as T;
    } catch (error: any) {
      console.error('[API] Request failed:', error);
      
      // Handle network errors
      if (error.name === 'TypeError' && (error.message.includes('fetch') || error.message.includes('Network'))) {
        throw new Error(`Cannot connect to backend server. Please check:\n1. Backend is running\n2. EXPO_PUBLIC_API_BASE_URL is set correctly\n3. Your internet connection`);
      }
      
      // Handle CORS errors
      if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
        throw new Error('Backend server is not accessible. Please check CORS settings and backend URL.');
      }
      
      // Re-throw if it's already an ApiError
      if (error.status || error.code) {
        throw error;
      }
      
      // Wrap other errors
      throw new Error(error.message || 'An unexpected error occurred. Please try again.');
    }
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async patch<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();

