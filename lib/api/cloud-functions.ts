// Cloud Functions client for Firebase Cloud Functions
// This client handles authentication and provides easy access to all Cloud Functions
import { auth } from '../firebase/config';

// ==================== ADMIN CLOUD FUNCTIONS ====================
const ADMIN_FUNCTIONS = {
  getAllUsers: 'https://getallusers-q3rjv54uka-uc.a.run.app',
  grantAdminRole: 'https://grantadminrole-q3rjv54uka-uc.a.run.app',
  revokeAdminRole: 'https://revokeadminrole-q3rjv54uka-uc.a.run.app',
  getPlatformSettings: 'https://getplatformsettings-q3rjv54uka-uc.a.run.app',
  updatePlatformSettings: 'https://updateplatformsettings-q3rjv54uka-uc.a.run.app',
  getAllOrders: 'https://getallorders-q3rjv54uka-uc.a.run.app',
  resolveDispute: 'https://resolvedispute-q3rjv54uka-uc.a.run.app',
  getAllPayouts: 'https://getallpayouts-q3rjv54uka-uc.a.run.app',
  
  // Parks Management (Admin)
  createPark: 'https://createpark-q3rjv54uka-uc.a.run.app',
  updatePark: 'https://updatepark-q3rjv54uka-uc.a.run.app',
  deletePark: 'https://deletepark-q3rjv54uka-uc.a.run.app',
  initializeParks: 'https://initializeparks-q3rjv54uka-uc.a.run.app',
  
  // Security & Admin Functions
  getAccessLogs: 'https://getaccesslogs-q3rjv54uka-uc.a.run.app',
  getFailedLogins: 'https://getfailedlogins-q3rjv54uka-uc.a.run.app',
  getApiKeys: 'https://getapikeys-q3rjv54uka-uc.a.run.app',
  createApiKey: 'https://createapikey-q3rjv54uka-uc.a.run.app',
  revokeApiKey: 'https://revokeapikey-q3rjv54uka-uc.a.run.app',
  getSecuritySettings: 'https://getsecuritysettings-q3rjv54uka-uc.a.run.app',
  updateSecuritySettings: 'https://updatesecuritysettings-q3rjv54uka-uc.a.run.app',
  getAuditTrail: 'https://getaudittrail-q3rjv54uka-uc.a.run.app',
  getFirestoreRules: 'https://getfirestorerules-q3rjv54uka-uc.a.run.app',
};

// ==================== SELLER CLOUD FUNCTIONS ====================
const SELLER_FUNCTIONS = {
  // Products
  getSellerProducts: 'https://getsellerproducts-q3rjv54uka-uc.a.run.app',
  getProduct: 'https://getproduct-q3rjv54uka-uc.a.run.app',
  createProduct: 'https://createproduct-q3rjv54uka-uc.a.run.app',
  updateProduct: 'https://updateproduct-q3rjv54uka-uc.a.run.app',
  deleteProduct: 'https://deleteproduct-q3rjv54uka-uc.a.run.app',
  
  // Products with category-specific fields
  createProductWithCategory: 'https://createnorthernproduct-q3rjv54uka-uc.a.run.app',
  updateProductWithCategory: 'https://updatenorthernproduct-q3rjv54uka-uc.a.run.app',
  
  // Dashboard & Analytics
  getDashboardStats: 'https://getdashboardstats-q3rjv54uka-uc.a.run.app',
  getSellerAnalytics: 'https://getselleranalytics-q3rjv54uka-uc.a.run.app',
  
  // Reports
  generateSalesReport: 'https://generatesalesreport-q3rjv54uka-uc.a.run.app',
  generateCustomerReport: 'https://generatecustomerreport-q3rjv54uka-uc.a.run.app',
  
  // Discount Codes
  createDiscountCode: 'https://creatediscountcode-q3rjv54uka-uc.a.run.app',
  getDiscountCodes: 'https://getdiscountcodes-q3rjv54uka-uc.a.run.app',
  updateDiscountCode: 'https://updatediscountcode-q3rjv54uka-uc.a.run.app',
  deleteDiscountCode: 'https://deletediscountcode-q3rjv54uka-uc.a.run.app',
  
  // Store Management
  getStoreSettings: 'https://getstoresettings-q3rjv54uka-uc.a.run.app',
  updateStoreSettings: 'https://updatestoresettings-q3rjv54uka-uc.a.run.app',
  
  // Customers
  getCustomers: 'https://getcustomers-q3rjv54uka-uc.a.run.app',
  
  // Order Availability
  markOrderAsNotAvailable: 'https://markorderasnotavailable-q3rjv54uka-uc.a.run.app',
  
  // Shipping Zones
  getShippingZones: 'https://getshippingzones-q3rjv54uka-uc.a.run.app',
  createShippingZone: 'https://createshippingzone-q3rjv54uka-uc.a.run.app',
  updateShippingZone: 'https://updateshippingzone-q3rjv54uka-uc.a.run.app',
  deleteShippingZone: 'https://deleteshippingzone-q3rjv54uka-uc.a.run.app',
  getShippingSettings: 'https://getshippingsettings-q3rjv54uka-uc.a.run.app',
  updateShippingSettings: 'https://updateshippingsettings-q3rjv54uka-uc.a.run.app',
  
  // Earnings & Transactions
  calculateSellerEarnings: 'https://calculatesellerearnings-q3rjv54uka-uc.a.run.app',
  getSellerTransactions: 'https://getsellertransactions-q3rjv54uka-uc.a.run.app',
};

// ==================== SHARED CLOUD FUNCTIONS ====================
const SHARED_FUNCTIONS = {
  // Payment Functions
  initializePaystackTransaction: 'https://initializepaystacktransaction-q3rjv54uka-uc.a.run.app',
  verifyPaystackTransaction: 'https://verifypaystacktransaction-q3rjv54uka-uc.a.run.app',
  paystackWebhook: 'https://paystackwebhook-q3rjv54uka-uc.a.run.app',
  verifyPaymentAndCreateOrder: 'https://verifypaymentandcreateorder-q3rjv54uka-uc.a.run.app',
  findRecentTransactionByEmail: 'https://findrecenttransactionbyemail-q3rjv54uka-uc.a.run.app',
  
  // Parks Functions (Public)
  getAllParks: 'https://getallparks-q3rjv54uka-uc.a.run.app',
  getParksByState: 'https://getparksbystate-q3rjv54uka-uc.a.run.app',
  
  // Order Functions
  updateOrderStatus: 'https://updateorderstatus-q3rjv54uka-uc.a.run.app',
  markOrderAsSent: 'https://markorderassent-q3rjv54uka-uc.a.run.app',
  markOrderAsReceived: 'https://markorderasreceived-q3rjv54uka-uc.a.run.app',
  getOrdersByCustomer: 'https://getordersbycustomer-q3rjv54uka-uc.a.run.app',
  getOrdersBySeller: 'https://getordersbyseller-q3rjv54uka-uc.a.run.app',
  
  // Shipping Functions
  calculateShippingOptions: 'https://calculateshippingoptions-q3rjv54uka-uc.a.run.app',
  getPublicShippingZones: 'https://getpublicshippingzones-q3rjv54uka-uc.a.run.app',
  
  // Payout Functions
  getBanksList: 'https://getbankslist-q3rjv54uka-uc.a.run.app',
  resolveAccountNumber: 'https://resolveaccountnumber-q3rjv54uka-uc.a.run.app',
  savePayoutDetails: 'https://savepayoutdetails-q3rjv54uka-uc.a.run.app',
  requestPayout: 'https://requestpayout-q3rjv54uka-uc.a.run.app',
  cancelPayoutRequest: 'https://cancelpayoutrequest-q3rjv54uka-uc.a.run.app',
  
  // Order Availability
  respondToAvailabilityCheck: 'https://respondtoavailabilitycheck-q3rjv54uka-uc.a.run.app',
  
  // Chat Functions
  sendOrderMessage: 'https://sendordermessage-q3rjv54uka-uc.a.run.app',
  
  // User Functions
  linkGuestOrdersToAccount: 'https://linkguestorderstoaccount-q3rjv54uka-uc.a.run.app',
  
  // Search Functions
  searchProducts: 'https://searchproducts-q3rjv54uka-uc.a.run.app',
  
  // Market Street Functions
  createMarketPost: 'https://createmarketpost-q3rjv54uka-uc.a.run.app',
  likeMarketPost: 'https://likemarketpost-q3rjv54uka-uc.a.run.app',
  deleteMarketPost: 'https://deletemarketpost-q3rjv54uka-uc.a.run.app',
  incrementPostViews: 'https://incrementpostviews-q3rjv54uka-uc.a.run.app',
  createMarketComment: 'https://createmarketcomment-q3rjv54uka-uc.a.run.app',
  deleteMarketComment: 'https://deletemarketcomment-q3rjv54uka-uc.a.run.app',
  createMarketChat: 'https://createmarketchat-q3rjv54uka-uc.a.run.app',
  sendMarketMessage: 'https://sendmarketmessage-q3rjv54uka-uc.a.run.app',
  
  // Test Function
  helloWorld: 'https://helloworld-q3rjv54uka-uc.a.run.app',
};

const CLOUD_FUNCTIONS_DEBUG = false;

function cloudDebug(...args: any[]) {
  if (!CLOUD_FUNCTIONS_DEBUG) return;
  console.log(...args);
}

function cloudWarn(...args: any[]) {
  if (!CLOUD_FUNCTIONS_DEBUG) return;
  console.warn(...args);
}

export interface CloudFunctionError {
  message: string;
  code?: string;
  status?: number;
  url?: string;
  functionName?: string;
}

class CloudFunctionsClient {
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

  /**
   * Get Firebase ID token for authentication
   * Uses cached token when possible to avoid quota issues
   */
  private async getIdToken(forceRefresh: boolean = false): Promise<string | null> {
    try {
      const user = auth.currentUser;
      if (!user) {
        cloudWarn('[Cloud Function] No authenticated user');
        return null;
      }
      // Force refresh if requested, otherwise use cached token
      // Firebase SDK will automatically refresh if token is expired
      const token = await user.getIdToken(forceRefresh);
      if (!token) {
        cloudWarn('[Cloud Function] Failed to get ID token');
      }
      return token;
    } catch (error: any) {
      // Handle quota exceeded errors gracefully
      if (error?.code === 'auth/quota-exceeded') {
        cloudWarn('Firebase Auth quota exceeded. Using cached token if available.');
        // Try to get cached token (don't force refresh)
        try {
          const user = auth.currentUser;
          if (user) {
            // Get cached token only (may return null if no cache)
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

  /**
   * Make a request to a Cloud Function with retry logic for rate limits
   */
  private async request<T>(
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

    // Add authentication if required
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

    // Retry logic with exponential backoff
    let lastError: any;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff: 1s, 2s, 4s
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

        // Handle network errors
        if (!response) {
          throw new Error('No response from server. Please check your internet connection.');
        }

        // Handle non-JSON responses (like GET requests that return plain text)
        const contentType = response.headers.get('content-type');
        const isJson = contentType && contentType.includes('application/json');
        
        let data: any;
        
        if (isJson) {
          try {
            data = await response.json();
          } catch {
            // If JSON parsing fails, try to get text
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

        // If old/stale Cloud Run URL returns 404, try Firebase cloudfunctions.net fallback once.
        if (response.status === 404 && !tried404Fallback) {
          const fallbackUrl = this.get404FallbackUrl(requestUrl);
          if (fallbackUrl && fallbackUrl !== requestUrl) {
            tried404Fallback = true;
            cloudWarn(`[Cloud Function] 404 on ${requestUrl}. Retrying with fallback ${fallbackUrl}`);
            requestUrl = fallbackUrl;
            continue;
          }
        }

        // Check for success field in response
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
          
          // Retry on rate limit (503) or server errors (500-502, 504)
          if (response.status === 503 || (response.status >= 500 && response.status < 505)) {
            if (attempt < retries) {
              lastError = error;
              cloudWarn(`[Cloud Function] Server error ${response.status}, will retry...`);
              continue; // Retry the request
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
          
          // Handle 401 Unauthorized - try refreshing token once
          if (response.status === 401 && requiresAuth && attempt === 0) {
            cloudWarn('[Cloud Function] 401 Unauthorized, attempting token refresh...');
            try {
              const refreshedToken = await this.getIdToken(true); // Force refresh
              if (refreshedToken) {
                headers['Authorization'] = `Bearer ${refreshedToken}`;
                requestOptions.headers = headers;
                authToken = refreshedToken;
                lastError = error;
                continue; // Retry with refreshed token
              }
            } catch (refreshError) {
              console.error('[Cloud Function] Token refresh failed:', refreshError);
            }
          }
          
          // Retry on rate limit (503) or server errors (500-502, 504)
          if (response.status === 503 || (response.status >= 500 && response.status < 505)) {
            if (attempt < retries) {
              lastError = error;
              cloudWarn(`[Cloud Function] Server error ${response.status}, will retry...`);
              continue; // Retry the request
            }
          }
          
          this.reportFunctionError(error);
          throw error;
        }

        cloudDebug('[Cloud Function] Success');
        return data as T;
      } catch (error: any) {
        // Network errors - retry if we have attempts left
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
          if (attempt < retries) {
            lastError = error;
            cloudWarn('[Cloud Function] Network error, will retry...');
            continue; // Retry the request
          }
          throw new Error('Network request failed. Please check your internet connection and try again.');
        }
        
        // If it's already a CloudFunctionError with retryable status, continue retry loop
        if (error.status === 503 || (error.status >= 500 && error.status < 505)) {
          if (attempt < retries) {
            lastError = error;
            continue; // Retry the request
          }
        }
        
        // Re-throw other errors or if we've exhausted retries
        if (error.status || error.code) {
          throw error; // CloudFunctionError - throw as-is
        }
        
        lastError = error;
        if (attempt === retries) {
          // Exhausted retries
          if (error.message) {
            throw new Error(error.message);
          }
          throw new Error('An unexpected error occurred. Please try again.');
        }
      }
    }
    
    // If we get here, all retries were exhausted
    throw lastError || new Error('Request failed after retries');
  }

  // ==================== ADMIN FUNCTIONS ====================

  /**
   * Get all users (paginated)
   */
  async getAllUsers(data?: {
    limit?: number;
    startAfter?: string;
    role?: 'user' | 'customer' | 'seller' | 'admin';
  }): Promise<{
    success: boolean;
    users: any[];
    hasMore: boolean;
  }> {
    return this.request(ADMIN_FUNCTIONS.getAllUsers, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Grant admin role to user
   */
  async grantAdminRole(userId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.request(ADMIN_FUNCTIONS.grantAdminRole, {
      method: 'POST',
      body: { userId },
      requiresAuth: true,
    });
  }

  /**
   * Revoke admin role from user
   */
  async revokeAdminRole(userId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.request(ADMIN_FUNCTIONS.revokeAdminRole, {
      method: 'POST',
      body: { userId },
      requiresAuth: true,
    });
  }

  /**
   * Get platform settings
   */
  async getPlatformSettings(): Promise<{
    success: boolean;
    settings: {
      platformCommissionRate: number;
      minimumPayoutAmount: number;
      platformFee: number;
      currency: string;
      updatedAt: string;
      updatedBy: string;
    };
  }> {
    return this.request(ADMIN_FUNCTIONS.getPlatformSettings, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
  }

  /**
   * Update platform settings
   */
  async updatePlatformSettings(settings: {
    platformCommissionRate?: number;
    minimumPayoutAmount?: number;
    platformFee?: number;
    currency?: string;
  }): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.request(ADMIN_FUNCTIONS.updatePlatformSettings, {
      method: 'POST',
      body: { settings },
      requiresAuth: true,
    });
  }

  /**
   * Get all orders (paginated)
   */
  async getAllOrders(data?: {
    limit?: number;
    startAfter?: string;
    status?: string;
  }): Promise<{
    success: boolean;
    orders: any[];
    hasMore: boolean;
  }> {
    return this.request(ADMIN_FUNCTIONS.getAllOrders, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Resolve order dispute
   */
  async resolveDispute(data: {
    orderId: string;
    resolution: 'refund' | 'release';
    refundAmount?: number;
  }): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.request(ADMIN_FUNCTIONS.resolveDispute, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  // ==================== SELLER FUNCTIONS ====================

  /**
   * Get seller products (paginated)
   */
  async getSellerProducts(data?: {
    sellerId?: string;
    limit?: number;
    startAfter?: string;
    status?: 'active' | 'draft' | 'inactive';
  }): Promise<{
    success: boolean;
    products: any[];
    hasMore: boolean;
  }> {
    return this.request(SELLER_FUNCTIONS.getSellerProducts, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Get single product details
   */
  async getProduct(productId: string): Promise<{
    success: boolean;
    product: any;
  }> {
    return this.request(SELLER_FUNCTIONS.getProduct, {
      method: 'POST',
      body: { productId },
      requiresAuth: false,
    });
  }

  /**
   * Create product with image upload
   */
  async createProduct(data: {
    name: string;
    description?: string;
    price: number;
    compareAtPrice?: number;
    stock: number;
    sku?: string;
    category?: string;
    status?: 'active' | 'draft' | 'inactive';
    allowShipping?: boolean;
    imageBase64?: string;
    variants?: {
      name: string;
      options: {
        value: string;
        priceModifier: number;
        stock: number;
        sku?: string;
      }[];
    }[];
  }): Promise<{
    success: boolean;
    productId: string;
    product: any;
  }> {
    return this.request(SELLER_FUNCTIONS.createProduct, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Update product
   */
  async updateProduct(data: {
    productId: string;
    name?: string;
    description?: string;
    price?: number;
    compareAtPrice?: number;
    stock?: number;
    sku?: string;
    category?: string;
    status?: 'active' | 'draft' | 'inactive';
    imageBase64?: string;
    variants?: {
      name: string;
      options: {
        value: string;
        priceModifier: number;
        stock: number;
        sku?: string;
      }[];
    }[];
  }): Promise<{
    success: boolean;
    productId: string;
    message: string;
  }> {
    return this.request(SELLER_FUNCTIONS.updateProduct, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Delete product
   */
  async deleteProduct(productId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.request(SELLER_FUNCTIONS.deleteProduct, {
      method: 'POST',
      body: { productId },
      requiresAuth: true,
    });
  }

  /**
   * Create product with category-specific fields
   */
  async createProductWithCategory(data: {
    name: string;
    description?: string;
    price: number;
    compareAtPrice?: number;
    stock: number;
    sku?: string;
    category: string;
    status?: 'active' | 'draft' | 'inactive';
    imageBase64?: string; // Legacy support
    imageUrls?: string[];
    videoUrl?: string;
    audioDescription?: string;
    volume?: string;
    fragranceType?: string;
    container?: string;
    sizeType?: 'free-size' | 'abaya-length' | 'standard';
    abayaLength?: string;
    standardSize?: string;
    setIncludes?: string;
    material?: string;
    packaging?: string;
    quantity?: number;
    taste?: string;
    materialType?: string;
    customMaterialType?: string;
    fabricLength?: string;
    quality?: string;
    // Skincare fields
    skincareBrand?: string;
    skincareType?: string;
    skincareSize?: string;
    // Haircare fields
    haircareType?: string;
    haircareBrand?: string;
    haircareSize?: string;
    haircarePackageItems?: string[];
    // Islamic fields
    islamicType?: string;
    islamicSize?: string;
    islamicMaterial?: string;
    // Electronics fields
    brand?: string;
    model?: string;
    // Delivery settings
    deliveryFeePaidBy?: 'seller' | 'buyer';
    deliveryMethods?: {
      localDispatch?: { enabled: boolean };
      waybill?: { enabled: boolean };
      pickup?: { enabled: boolean; landmark?: string };
    };
  }): Promise<{
    success: boolean;
    productId: string;
    message: string;
  }> {
    return this.request(SELLER_FUNCTIONS.createProductWithCategory, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Update product with category-specific fields
   */
  async updateProductWithCategory(data: {
    productId: string;
    name?: string;
    description?: string;
    price?: number;
    compareAtPrice?: number;
    stock?: number;
    sku?: string;
    category?: string;
    status?: 'active' | 'draft' | 'inactive';
    imageBase64?: string; // Legacy support
    imageUrls?: string[];
    videoUrl?: string;
    audioDescription?: string;
    volume?: string;
    fragranceType?: string;
    container?: string;
    sizeType?: 'free-size' | 'abaya-length' | 'standard';
    abayaLength?: string;
    standardSize?: string;
    setIncludes?: string;
    material?: string;
    packaging?: string;
    quantity?: number;
    taste?: string;
    materialType?: string;
    customMaterialType?: string;
    fabricLength?: string;
    quality?: string;
    // Skincare fields
    skincareBrand?: string;
    skincareType?: string;
    skincareSize?: string;
    // Haircare fields
    haircareType?: string;
    haircareBrand?: string;
    haircareSize?: string;
    haircarePackageItems?: string[];
    // Islamic fields
    islamicType?: string;
    islamicSize?: string;
    islamicMaterial?: string;
    // Electronics fields
    brand?: string;
    model?: string;
    // Delivery settings
    deliveryFeePaidBy?: 'seller' | 'buyer';
    deliveryMethods?: {
      localDispatch?: { enabled: boolean };
      waybill?: { enabled: boolean };
      pickup?: { enabled: boolean; landmark?: string };
    };
  }): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.request(SELLER_FUNCTIONS.updateProductWithCategory, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Get dashboard stats
   */
  async getDashboardStats(sellerId?: string): Promise<{
    success: boolean;
    stats: {
      totalRevenue: number;
      totalOrders: number;
      totalProducts: number;
      totalCustomers: number;
      averageOrderValue: number;
      lowStockProducts: number;
      recentOrders: any[];
    };
  }> {
    return this.request(SELLER_FUNCTIONS.getDashboardStats, {
      method: 'POST',
      body: sellerId ? { sellerId } : {},
      requiresAuth: true,
    });
  }

  /**
   * Get seller analytics
   */
  async getSellerAnalytics(data?: {
    sellerId?: string;
    days?: number;
  }): Promise<{
    success: boolean;
    analytics: {
      dailyData: {
        date: string;
        revenue: number;
        orders: number;
      }[];
      productPerformance: {
        productId: string;
        name: string;
        sales: number;
        revenue: number;
      }[];
      totalRevenue: number;
      totalOrders: number;
    };
  }> {
    return this.request(SELLER_FUNCTIONS.getSellerAnalytics, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Generate sales report
   */
  async generateSalesReport(data?: {
    sellerId?: string;
    days?: number;
  }): Promise<{
    success: boolean;
    report: any;
  }> {
    return this.request(SELLER_FUNCTIONS.generateSalesReport, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Generate customer report
   */
  async generateCustomerReport(data?: {
    sellerId?: string;
    days?: number;
  }): Promise<{
    success: boolean;
    report: any;
  }> {
    return this.request(SELLER_FUNCTIONS.generateCustomerReport, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Create discount code
   */
  async createDiscountCode(data: {
    code: string;
    type: 'percentage' | 'fixed';
    value: number;
    maxUses?: number;
    minOrderAmount?: number;
    validFrom?: string;
    validUntil?: string;
    sellerId?: string;
  }): Promise<{
    success: boolean;
    discountCodeId: string;
    message: string;
  }> {
    return this.request(SELLER_FUNCTIONS.createDiscountCode, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Get discount codes
   */
  async getDiscountCodes(sellerId?: string): Promise<{
    success: boolean;
    discountCodes: any[];
  }> {
    return this.request(SELLER_FUNCTIONS.getDiscountCodes, {
      method: 'POST',
      body: sellerId ? { sellerId } : {},
      requiresAuth: true,
    });
  }

  /**
   * Update discount code
   */
  async updateDiscountCode(data: {
    discountCodeId: string;
    status?: 'active' | 'inactive' | 'expired';
    maxUses?: number;
    validUntil?: string;
  }): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.request(SELLER_FUNCTIONS.updateDiscountCode, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Delete discount code
   */
  async deleteDiscountCode(discountCodeId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.request(SELLER_FUNCTIONS.deleteDiscountCode, {
      method: 'POST',
      body: { discountCodeId },
      requiresAuth: true,
    });
  }

  /**
   * Get store settings
   */
  async getStoreSettings(sellerId?: string): Promise<{
    success: boolean;
    store: any;
  }> {
    return this.request(SELLER_FUNCTIONS.getStoreSettings, {
      method: 'POST',
      body: sellerId ? { sellerId } : {},
      requiresAuth: true,
    });
  }

  /**
   * Update store settings
   */
  async updateStoreSettings(data: {
    sellerId?: string;
    updateData: {
      storeName?: string;
      storeDescription?: string;
      logoBase64?: string;
      bannerBase64?: string;
      phone?: string;
      email?: string;
      [key: string]: any;
    };
  }): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.request(SELLER_FUNCTIONS.updateStoreSettings, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Get customers
   */
  async getCustomers(sellerId?: string): Promise<{
    success: boolean;
    customers: any[];
    segments: {
      vip: number;
      regular: number;
      new: number;
    };
  }> {
    return this.request(SELLER_FUNCTIONS.getCustomers, {
      method: 'POST',
      body: sellerId ? { sellerId } : {},
      requiresAuth: true,
    });
  }

  /**
   * Mark order as not available
   */
  async markOrderAsNotAvailable(data: {
    orderId: string;
    reason?: string;
    waitTimeDays?: number;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SELLER_FUNCTIONS.markOrderAsNotAvailable, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  // ==================== SHARED FUNCTIONS ====================

  /**
   * Verify Paystack payment and create order
   */
  async verifyPaymentAndCreateOrder(data: {
    reference: string;
    idempotencyKey: string;
    cartItems: any[];
    total: number;
    deliveryAddress: string;
    customerInfo: any;
    discountCode?: string;
    shippingType?: 'delivery' | 'pickup' | 'contact';
    shippingPrice?: number;
    deliveryFeePaidBy?: 'seller' | 'buyer';
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.verifyPaymentAndCreateOrder, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Initialize a Paystack transaction and return checkout URL
   */
  async initializePaystackTransaction(data: {
    amount: number;
    email: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
    reference?: string;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.initializePaystackTransaction, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Verify a Paystack transaction by reference
   */
  async verifyPaystackTransaction(data: {
    reference: string;
    expectedAmount?: number;
    expectedEmail?: string;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.verifyPaystackTransaction, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Find recent Paystack transaction by email and amount
   */
  async findRecentTransactionByEmail(data: {
    email: string;
    amount: number;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.findRecentTransactionByEmail, {
      method: 'POST',
      body: data,
      requiresAuth: false,
    });
  }

  /**
   * Update order status (seller or admin)
   */
  async updateOrderStatus(data: {
    orderId: string;
    status: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.updateOrderStatus, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Mark order as sent with optional photo (seller)
   */
  async markOrderAsSent(data: {
    orderId: string;
    photoUrl?: string;
    waybillParkId?: string;      // Park ID where item was sent from (for waybill orders)
    waybillParkName?: string;    // Park name for display (optional, can be derived from ID)
    [key: string]: any;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.markOrderAsSent, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Get all parks (public)
   */
  async getAllParks(): Promise<{
    success: boolean;
    parks: {
      id: string;
      name: string;
      city: string;
      state: string;
      isActive: boolean;
    }[];
  }> {
    return this.request(SHARED_FUNCTIONS.getAllParks, {
      method: 'GET',
      requiresAuth: false,
    });
  }

  /**
   * Get parks by state (public)
   */
  async getParksByState(state: string): Promise<{
    success: boolean;
    parks: {
      id: string;
      name: string;
      city: string;
      state: string;
      isActive: boolean;
    }[];
  }> {
    return this.request(SHARED_FUNCTIONS.getParksByState, {
      method: 'POST',
      body: { state },
      requiresAuth: false, // Public function - doesn't require authentication
    });
  }

  /**
   * Mark order as received with optional photo (customer)
   */
  async markOrderAsReceived(data: {
    orderId: string;
    photoUrl?: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.markOrderAsReceived, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Get all orders for a customer
   */
  async getOrdersByCustomer(data?: any): Promise<any> {
    return this.request(SHARED_FUNCTIONS.getOrdersByCustomer, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Get all orders for a seller
   */
  async getOrdersBySeller(data?: any): Promise<any> {
    return this.request(SHARED_FUNCTIONS.getOrdersBySeller, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Calculate shipping options for cart
   */
  async calculateShippingOptions(data: {
    items: { productId: string; quantity: number }[];
    deliveryAddress?: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.calculateShippingOptions, {
      method: 'POST',
      body: data,
      requiresAuth: false,
    });
  }

  /**
   * Get list of Nigerian banks from Paystack
   */
  async getBanksList(): Promise<{ banks: { name: string; code: string; [key: string]: any }[] }> {
    return this.request(SHARED_FUNCTIONS.getBanksList, {
      method: 'GET',
      requiresAuth: false,
    });
  }

  /**
   * Resolve bank account number to account name
   */
  async resolveAccountNumber(data: {
    accountNumber: string;
    bankCode: string;
  }): Promise<{
    accountName: string;
    accountNumber: string;
    bankCode?: string;
    [key: string]: any;
  }> {
    return this.request(SHARED_FUNCTIONS.resolveAccountNumber, {
      method: 'POST',
      body: data,
      requiresAuth: false,
    });
  }

  /**
   * Save payout bank account details (seller)
   */
  async savePayoutDetails(data: {
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.savePayoutDetails, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Send message in order chat (customer or seller)
   */
  async sendOrderMessage(data: {
    orderId: string;
    message: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.sendOrderMessage, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Link guest orders to user account after signup/login
   */
  async linkGuestOrdersToAccount(data?: {
    guestEmail?: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.linkGuestOrdersToAccount, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Search products by query
   */
  async searchProducts(data: {
    query: string;
    limit?: number;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.searchProducts, {
      method: 'POST',
      body: data,
      requiresAuth: false,
    });
  }

  /**
   * Get public shipping zones
   */
  async getPublicShippingZones(data: {
    sellerId: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.getPublicShippingZones, {
      method: 'POST',
      body: data,
      requiresAuth: false,
    });
  }

  /**
   * Get shipping zones (authenticated)
   */
  async getShippingZones(data?: {
    sellerId?: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SELLER_FUNCTIONS.getShippingZones, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Create shipping zone
   */
  async createShippingZone(data: {
    sellerId: string;
    name: string;
    rate: number;
    states?: string[];
    freeThreshold?: number;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SELLER_FUNCTIONS.createShippingZone, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Update shipping zone
   */
  async updateShippingZone(data: {
    sellerId: string;
    zoneId: string;
    name?: string;
    rate?: number;
    states?: string[];
    freeThreshold?: number;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SELLER_FUNCTIONS.updateShippingZone, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Delete shipping zone
   */
  async deleteShippingZone(data: {
    sellerId: string;
    zoneId: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SELLER_FUNCTIONS.deleteShippingZone, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Get shipping settings
   */
  async getShippingSettings(data?: {
    sellerId?: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SELLER_FUNCTIONS.getShippingSettings, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Update shipping settings
   */
  async updateShippingSettings(data: {
    sellerId: string;
    defaultPackagingType?: string;
    packagingCost?: number;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SELLER_FUNCTIONS.updateShippingSettings, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Request payout
   */
  async requestPayout(data: {
    amount: number;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.requestPayout, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Cancel payout request
   */
  async cancelPayoutRequest(data: {
    payoutId: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.cancelPayoutRequest, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Get all payouts (admin)
   */
  async getAllPayouts(data?: {
    status?: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.getAllPayouts, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Calculate seller earnings
   */
  async calculateSellerEarnings(data?: {
    sellerId?: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SELLER_FUNCTIONS.calculateSellerEarnings, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Get seller transactions
   */
  async getSellerTransactions(data?: {
    sellerId?: string;
    limit?: number;
    [key: string]: any;
  }): Promise<any> {
    return this.request(SELLER_FUNCTIONS.getSellerTransactions, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Respond to availability check
   */
  async respondToAvailabilityCheck(data: {
    orderId: string;
    response: 'accepted' | 'cancelled';
    [key: string]: any;
  }): Promise<any> {
    return this.request(SHARED_FUNCTIONS.respondToAvailabilityCheck, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Create park (admin)
   */
  async createPark(data: {
    name: string;
    city: string;
    state: string;
    isActive?: boolean;
    [key: string]: any;
  }): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.createPark, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Update park (admin)
   */
  async updatePark(data: {
    parkId: string;
    name?: string;
    city?: string;
    state?: string;
    isActive?: boolean;
    [key: string]: any;
  }): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.updatePark, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Delete park (admin)
   */
  async deletePark(data: {
    parkId: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.deletePark, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Initialize parks (admin)
   */
  async initializeParks(): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.initializeParks, {
      method: 'POST',
      requiresAuth: true,
    });
  }

  /**
   * Get access logs (admin)
   */
  async getAccessLogs(data?: {
    limit?: number;
    startAfter?: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.getAccessLogs, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Get failed logins (admin)
   */
  async getFailedLogins(data?: {
    limit?: number;
    [key: string]: any;
  }): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.getFailedLogins, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Get API keys (admin)
   */
  async getApiKeys(): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.getApiKeys, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
  }

  /**
   * Create API key (admin)
   */
  async createApiKey(data: {
    name: string;
    scopes: string[];
    rateLimit?: number;
    expiresInDays?: number;
    [key: string]: any;
  }): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.createApiKey, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Revoke API key (admin)
   */
  async revokeApiKey(data: {
    apiKeyId: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.revokeApiKey, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Get security settings (admin)
   */
  async getSecuritySettings(): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.getSecuritySettings, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
  }

  /**
   * Update security settings (admin)
   */
  async updateSecuritySettings(data: {
    [key: string]: any;
  }): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.updateSecuritySettings, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Get audit trail (admin)
   */
  async getAuditTrail(data?: {
    limit?: number;
    startAfter?: string;
    resourceType?: string;
    userId?: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.getAuditTrail, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
  }

  /**
   * Get Firestore rules (admin)
   */
  async getFirestoreRules(): Promise<any> {
    return this.request(ADMIN_FUNCTIONS.getFirestoreRules, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
  }

  /**
   * Simple test function
   */
  async helloWorld(): Promise<any> {
    return this.request(SHARED_FUNCTIONS.helloWorld, {
      method: 'GET',
      requiresAuth: false,
    });
  }

  // ==================== MARKET STREET FUNCTIONS ====================

  /**
   * Create Market Post with image uploads
   */
  async createMarketPost(data: {
    images: string[]; // Base64 encoded images
    hashtags?: string[];
    price?: number;
    isNegotiable?: boolean;
    description?: string;
    location?: {
      state?: string;
      city?: string;
    };
    contactMethod?: 'in-app' | 'whatsapp';
  }): Promise<{
    success: boolean;
    post: any;
    postId: string;
  }> {
    return this.request(SHARED_FUNCTIONS.createMarketPost, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Like/unlike a Market Post
   */
  async likeMarketPost(postId: string): Promise<{
    success: boolean;
    likes: number;
    isLiked: boolean;
  }> {
    return this.request(SHARED_FUNCTIONS.likeMarketPost, {
      method: 'POST',
      body: { postId },
      requiresAuth: true,
    });
  }

  /**
   * Delete Market Post (poster only)
   */
  async deleteMarketPost(postId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.request(SHARED_FUNCTIONS.deleteMarketPost, {
      method: 'POST',
      body: { postId },
      requiresAuth: true,
    });
  }

  /**
   * Increment post view count (public, no auth required)
   */
  async incrementPostViews(postId: string): Promise<{
    success: boolean;
  }> {
    return this.request(SHARED_FUNCTIONS.incrementPostViews, {
      method: 'POST',
      body: { postId },
      requiresAuth: false,
    });
  }

  /**
   * Create Market Comment
   */
  async createMarketComment(data: {
    postId: string;
    comment: string;
  }): Promise<{
    success: boolean;
    commentId: string;
    message: string;
  }> {
    return this.request(SHARED_FUNCTIONS.createMarketComment, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Delete Market Comment
   */
  async deleteMarketComment(commentId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.request(SHARED_FUNCTIONS.deleteMarketComment, {
      method: 'POST',
      body: { commentId },
      requiresAuth: true,
    });
  }

  /**
   * Create Market Chat
   */
  async createMarketChat(data: {
    postId: string;
    receiverId?: string;
    buyerId?: string;
    posterId?: string;
  }): Promise<{
    success: boolean;
    chatId: string;
    chat: any;
  }> {
    return this.request(SHARED_FUNCTIONS.createMarketChat, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }

  /**
   * Send Market Message
   */
  async sendMarketMessage(data: {
    chatId: string;
    message: string;
    imageUrl?: string;
    paymentLink?: string;
  }): Promise<{
    success: boolean;
    messageId: string;
    message: string;
  }> {
    return this.request(SHARED_FUNCTIONS.sendMarketMessage, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  }
}

// Export singleton instance
export const cloudFunctions = new CloudFunctionsClient();
