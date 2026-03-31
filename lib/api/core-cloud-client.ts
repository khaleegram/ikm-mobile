import { auth } from '../firebase/config';

export interface CloudFunctionError {
  message: string;
  code?: string;
  status?: number;
  url?: string;
  functionName?: string;
}

const CLOUD_FUNCTIONS_DEBUG = false;

function cloudDebug(...args: any[]) {
  if (!CLOUD_FUNCTIONS_DEBUG) return;
  console.log(...args);
}

function cloudWarn(...args: any[]) {
  if (!CLOUD_FUNCTIONS_DEBUG) return;
  console.warn(...args);
}

export class CoreCloudClient {
  private getFunctionNameFromUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);

      if (parsedUrl.hostname.endsWith('.a.run.app')) {
        const serviceName = parsedUrl.hostname.split('.')[0] || '';
        return serviceName.split('-')[0] || serviceName || 'unknown';
      }

      if (parsedUrl.hostname.includes('.cloudfunctions.net')) {
        const pathName = parsedUrl.pathname.replace(/^\/+/, '');
        if (pathName) return pathName;
      }
    } catch {
      // Ignore parse errors and fallback below.
    }
    return 'unknown';
  }

  private get404FallbackUrl(url: string): string | null {
    const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim();
    if (!projectId) return null;

    try {
      const parsedUrl = new URL(url);
      if (!parsedUrl.hostname.endsWith('.a.run.app')) return null;

      const functionName = this.getFunctionNameFromUrl(url);
      if (!functionName || functionName === 'unknown') return null;

      return `https://us-central1-${projectId}.cloudfunctions.net/${functionName}`;
    } catch {
      return null;
    }
  }

  private isExpectedPaymentVerificationState(error: CloudFunctionError): boolean {
    const functionName = String(error?.functionName || '').trim().toLowerCase();
    if (functionName !== 'verifypaystacktransaction') return false;
    if (Number(error?.status) !== 400) return false;

    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('payment not successful') ||
      message.includes('status: abandoned') ||
      message.includes('abandoned') ||
      message.includes('pending')
    );
  }

  private reportFunctionError(error: CloudFunctionError): void {
    if (this.isExpectedPaymentVerificationState(error)) {
      cloudDebug('[Cloud Function] Expected payment verification state:', error);
      return;
    }
    console.error('[Cloud Function] Error response:', error);
  }

  public async getIdToken(forceRefresh: boolean = false): Promise<string | null> {
    try {
      const user = auth.currentUser;
      if (!user) {
        cloudWarn('[Cloud Function] No authenticated user');
        return null;
      }
      const token = await user.getIdToken(forceRefresh);
      if (!token) {
        cloudWarn('[Cloud Function] Failed to get ID token');
      }
      return token;
    } catch (error: any) {
      if (error?.code === 'auth/quota-exceeded') {
        cloudWarn('Firebase Auth quota exceeded. Using cached token if available.');
        try {
          const user = auth.currentUser;
          if (user) {
            return await user.getIdToken(false);
          }
        } catch (retryError) {
          console.error('Error getting cached token:', retryError);
        }
        return null;
      }
      console.error('Error getting ID token:', error);
      return null;
    }
  }

  public async request<T>(
    url: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: any;
      requiresAuth?: boolean;
      retries?: number;
    } = {}
  ): Promise<T> {
    const { method = 'POST', body, requiresAuth = false, retries = 3 } = options;
    let requestUrl = url;
    let tried404Fallback = false;

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    let authToken: string | null = null;
    if (requiresAuth) {
      authToken = await this.getIdToken(false);
      if (!authToken) {
        throw new Error('Authentication required. Please log in.');
      }
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const requestOptions: RequestInit = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      requestOptions.body = JSON.stringify(body);
    }

    let lastError: any;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          const delayMs = Math.pow(2, attempt - 1) * 1000;
          cloudDebug(`[Cloud Function] Retry attempt ${attempt}/${retries} after ${delayMs}ms delay`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        
        cloudDebug(`[Cloud Function] ${method} ${requestUrl}`, {
          requiresAuth,
          hasBody: !!body,
          attempt: attempt + 1,
          functionName: this.getFunctionNameFromUrl(requestUrl),
        });
        
        const response = await fetch(requestUrl, requestOptions);

        if (!response) {
          throw new Error('No response from server. Please check your internet connection.');
        }

        const contentType = response.headers.get('content-type');
        const isJson = contentType && contentType.includes('application/json');
        
        let data: any;
        
        if (isJson) {
          try {
            data = await response.json();
          } catch {
            const text = await response.text();
            console.error('[Cloud Function] Failed to parse JSON:', text);
            throw new Error(`Server returned invalid response. Status: ${response.status}`);
          }
        } else {
          const text = await response.text();
          if (text) {
            try {
              data = JSON.parse(text);
            } catch {
              data = { message: text };
            }
          } else {
            data = {};
          }
        }

        if (response.status === 404 && !tried404Fallback) {
          const fallbackUrl = this.get404FallbackUrl(requestUrl);
          if (fallbackUrl && fallbackUrl !== requestUrl) {
            tried404Fallback = true;
            cloudWarn(`[Cloud Function] 404 on ${requestUrl}. Retrying with fallback ${fallbackUrl}`);
            requestUrl = fallbackUrl;
            continue;
          }
        }

        if (data.success === false) {
          const defaultMessage =
            response.status === 404
              ? `Cloud Function endpoint not found (404): ${this.getFunctionNameFromUrl(requestUrl)}`
              : `Request failed with status ${response.status}`;
          const errorMessage = data.error || data.message || defaultMessage;
          const error: CloudFunctionError = {
            message: errorMessage,
            code: data.code,
            status: response.status,
            url: requestUrl,
            functionName: this.getFunctionNameFromUrl(requestUrl),
          };
          
          if (response.status === 503 || (response.status >= 500 && response.status < 505)) {
            if (attempt < retries) {
              lastError = error;
              cloudWarn(`[Cloud Function] Server error ${response.status}, will retry...`);
              continue;
            }
          }
          
          this.reportFunctionError(error);
          throw error;
        }

        if (!response.ok) {
          const defaultMessage =
            response.status === 404
              ? `Cloud Function endpoint not found (404): ${this.getFunctionNameFromUrl(requestUrl)}`
              : `HTTP ${response.status}: ${response.statusText}`;
          const errorMessage = data.message || data.error || data.errorMessage || defaultMessage;
          const error: CloudFunctionError = {
            message: errorMessage,
            code: data.code || data.errorCode,
            status: response.status,
            url: requestUrl,
            functionName: this.getFunctionNameFromUrl(requestUrl),
          };
          
          if (response.status === 401 && requiresAuth && attempt === 0) {
            cloudWarn('[Cloud Function] 401 Unauthorized, attempting token refresh...');
            try {
              const refreshedToken = await this.getIdToken(true);
              if (refreshedToken) {
                headers['Authorization'] = `Bearer ${refreshedToken}`;
                requestOptions.headers = headers;
                authToken = refreshedToken;
                lastError = error;
                continue;
              }
            } catch (refreshError) {
              console.error('[Cloud Function] Token refresh failed:', refreshError);
            }
          }
          
          if (response.status === 503 || (response.status >= 500 && response.status < 505)) {
            if (attempt < retries) {
              lastError = error;
              cloudWarn(`[Cloud Function] Server error ${response.status}, will retry...`);
              continue;
            }
          }
          
          this.reportFunctionError(error);
          throw error;
        }

        cloudDebug('[Cloud Function] Success');
        return data as T;
      } catch (error: any) {
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
          if (attempt < retries) {
            lastError = error;
            cloudWarn('[Cloud Function] Network error, will retry...');
            continue;
          }
          throw new Error('Network request failed. Please check your internet connection and try again.');
        }
        
        if (error.status === 503 || (error.status >= 500 && error.status < 505)) {
          if (attempt < retries) {
            lastError = error;
            continue;
          }
        }
        
        if (error.status || error.code) {
          throw error;
        }
        
        lastError = error;
        if (attempt === retries) {
          if (error.message) {
            throw new Error(error.message);
          }
          throw new Error('An unexpected error occurred. Please try again.');
        }
      }
    }
    
    throw lastError || new Error('Request failed after retries');
  }
}

export const coreCloudClient = new CoreCloudClient();
