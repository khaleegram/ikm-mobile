// Parks API client
// Handles fetching parks for waybill deliveries
import { coreCloudClient } from './core-cloud-client';
import { Park } from '@/types';

const PARK_FUNCTIONS = {
  getAllParks: 'https://getallparks-q3rjv54uka-uc.a.run.app',
  getParksByState: 'https://getparksbystate-q3rjv54uka-uc.a.run.app',
};

export const parksApi = {
  /**
   * Get all parks
   */
  getAll: async (): Promise<Park[]> => {
    try {
      const response = await coreCloudClient.request<{ success: boolean; parks: any[] }>(PARK_FUNCTIONS.getAllParks, {
        method: 'POST',
        body: {},
        requiresAuth: true,
      });
      if (!response.success) {
        throw new Error('Failed to fetch parks');
      }
      return response.parks.map((park: any) => ({
        id: park.id,
        name: park.name,
        city: park.city,
        state: park.state,
        isActive: park.isActive,
      }));
    } catch (error: any) {
      console.error('Error fetching parks:', error);
      throw new Error(error.message || 'Failed to fetch parks');
    }
  },

  /**
   * Get parks by state
   */
  getByState: async (state: string): Promise<Park[]> => {
    try {
      const response = await coreCloudClient.request<{ success: boolean; parks: any[] }>(PARK_FUNCTIONS.getParksByState, {
        method: 'POST',
        body: { state },
        requiresAuth: true,
      });
      if (!response.success) {
        throw new Error('Failed to fetch parks by state');
      }
      return response.parks
        .filter((park: any) => park.isActive) // Only return active parks
        .map((park: any) => ({
          id: park.id,
          name: park.name,
          city: park.city,
          state: park.state,
          isActive: park.isActive,
        }));
    } catch (error: any) {
      // Silently handle 403/401 errors as parks API may not be configured
      const status = error?.status || error?.response?.status || error?.code;
      if (status === 403 || status === 401) {
        // Parks API endpoint may not be configured or may require authentication
        // Return empty array to gracefully degrade functionality
        return [];
      }
      // Only log unexpected errors
      if (error?.message && !error.message.includes('403') && !error.message.includes('Forbidden')) {
        console.error('Error fetching parks by state:', error);
      }
      throw new Error(error.message || 'Failed to fetch parks by state');
    }
  },
};


