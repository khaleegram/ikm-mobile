'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  archiveAdminCampaign,
  createAdminCampaign,
  getAdminCampaign,
  getPromoReconciliation,
  listAdminCampaigns,
  setAdminCampaignEnabled,
  updateAdminCampaign,
  type CampaignInput,
  type CampaignPatch,
} from '@/lib/api/promo-admin';
import { queryKeys } from '@/lib/query/keys';

/**
 * Campaigns change when an operator changes them, not on a timer, so the list is
 * cached and every mutation refreshes it. A campaign list is a handful of rows —
 * small enough to refetch whole rather than patch by hand.
 */
export function useAdminCampaigns(options?: { includeArchived?: boolean }) {
  return useQuery({
    queryKey: queryKeys.promo.campaigns(options?.includeArchived ?? false),
    queryFn: () => listAdminCampaigns(options),
    staleTime: 30_000,
  });
}

export function useAdminCampaign(id: string | null) {
  return useQuery({
    queryKey: queryKeys.promo.campaign(id || 'none'),
    queryFn: () => getAdminCampaign(id as string),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function usePromoReconciliation() {
  return useQuery({
    queryKey: queryKeys.promo.reconciliation(),
    queryFn: getPromoReconciliation,
    staleTime: 60_000,
  });
}

function useInvalidatePromos() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.promo.all });
  };
}

export function useCreateCampaign() {
  const invalidate = useInvalidatePromos();
  return useMutation({
    mutationFn: (input: CampaignInput) => createAdminCampaign(input),
    onSuccess: invalidate,
  });
}

export function useUpdateCampaign() {
  const invalidate = useInvalidatePromos();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CampaignPatch }) =>
      updateAdminCampaign(id, patch),
    onSuccess: invalidate,
  });
}

/**
 * On and off.
 *
 * The list is refreshed on settle rather than on success, because a refusal (a
 * budget already spent, say) also changes what the operator should see.
 */
export function useSetCampaignEnabled() {
  const invalidate = useInvalidatePromos();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setAdminCampaignEnabled(id, enabled),
    onSettled: invalidate,
  });
}

export function useArchiveCampaign() {
  const invalidate = useInvalidatePromos();
  return useMutation({
    mutationFn: (id: string) => archiveAdminCampaign(id),
    onSuccess: invalidate,
  });
}
