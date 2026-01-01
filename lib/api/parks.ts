// Parks API client
// Handles fetching parks for waybill deliveries
import { cloudFunctions } from './cloud-functions';
import { Park } from '@/types';

export const parksApi = {
  /**
   * Get all parks
   */
  getAll: async (): Promise<Park[]> => {
    try {
      const response = await cloudFunctions.getAllParks();
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
      const response = await cloudFunctions.getParksByState(state);
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
      console.error('Error fetching parks by state:', error);
      throw new Error(error.message || 'Failed to fetch parks by state');
    }
  },
};

