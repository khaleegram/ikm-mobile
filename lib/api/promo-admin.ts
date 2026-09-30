import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';

/**
 * Campaign management for operators.
 *
 * Everything here is a row. No discount is compiled into the app, so an operator can
 * start, cap, pause or retire an offer without a deploy — and the checkout that
 * applies it reads the same rows.
 *
 * All money is in kobo, like everywhere else on the money path. The form on screen
 * speaks Naira and converts here, so a stray decimal cannot reach the database.
 */

export type PromoCampaign = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
  /** The discount, in basis points. 1000 = 10%. */
  discountBps: number;
  /** The cap applied to the discount, in basis points of the order. */
  capBps: number;
  capFloorKobo: number;
  capCeilingKobo: number;
  /** A flat cap in kobo. Replaces the proportional cap when set. */
  capFlatKobo: number | null;
  firstOrderOnly: boolean;
  minOrderKobo: number;
  requiresTicket: boolean;
  ticketThresholdKobo: number;
  maxRedemptions: number | null;
  maxRedemptionsPerIdentity: number | null;
  budgetKobo: number;
  dailyPacingKobo: number | null;
  perSellerCapKobo: number | null;
  startsAt: string | null;
  endsAt: string | null;
  releaseWindowDays: number;
  archivedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Derived by the server, not stored. */
  status?: string;
  spentKobo?: number;
  remainingKobo?: number;
};

export type CampaignFields = Partial<
  Omit<
    PromoCampaign,
    'id' | 'code' | 'status' | 'spentKobo' | 'remainingKobo' | 'archivedAt'
  >
>;

export type CampaignInput = CampaignFields & {
  code: string;
  name: string;
};

/**
 * A change to an existing campaign.
 *
 * The code is deliberately absent. Orders already carry it in `promo_code`, so
 * renaming it would leave those orders pointing at a code that no longer exists —
 * the server refuses it too, rather than trusting this type to be the only caller.
 */
export type CampaignPatch = CampaignFields;

async function unwrap<T>(promise: Promise<{ success?: boolean; error?: string } & T>): Promise<T> {
  const response = await promise;
  if (response && response.success === false) {
    throw new Error(response.error || 'The server rejected that request.');
  }
  return response as T;
}

export async function listAdminCampaigns(options?: {
  includeArchived?: boolean;
}): Promise<PromoCampaign[]> {
  const query = options?.includeArchived ? '?includeArchived=true' : '';
  const response = await unwrap(
    coreCloudClient.request<{ success: boolean; campaigns: PromoCampaign[] }>(
      apiUrl(`/admin/promo/campaigns${query}`),
      { method: 'GET', requiresAuth: true }
    )
  );
  return response.campaigns ?? [];
}

export async function getAdminCampaign(id: string): Promise<{
  campaign: PromoCampaign;
  ledger: Record<string, unknown>[];
}> {
  return unwrap(
    coreCloudClient.request<{
      success: boolean;
      campaign: PromoCampaign;
      ledger: Record<string, unknown>[];
    }>(apiUrl(`/admin/promo/campaigns/${encodeURIComponent(id)}`), {
      method: 'GET',
      requiresAuth: true,
    })
  );
}

export async function createAdminCampaign(input: CampaignInput): Promise<PromoCampaign> {
  const response = await unwrap(
    coreCloudClient.request<{ success: boolean; campaign: PromoCampaign }>(
      apiUrl('/admin/promo/campaigns'),
      { method: 'POST', requiresAuth: true, body: input }
    )
  );
  return response.campaign;
}

export async function updateAdminCampaign(
  id: string,
  patch: CampaignPatch
): Promise<PromoCampaign> {
  const response = await unwrap(
    coreCloudClient.request<{ success: boolean; campaign: PromoCampaign }>(
      apiUrl(`/admin/promo/campaigns/${encodeURIComponent(id)}`),
      { method: 'PATCH', requiresAuth: true, body: patch }
    )
  );
  return response.campaign;
}

/**
 * The switch an operator reaches for most.
 *
 * Separate from `updateAdminCampaign` because turning an offer on or off should not
 * require sending the rest of the campaign back and risking a partial overwrite.
 */
export async function setAdminCampaignEnabled(
  id: string,
  enabled: boolean
): Promise<PromoCampaign> {
  const response = await unwrap(
    coreCloudClient.request<{ success: boolean; campaign: PromoCampaign }>(
      apiUrl(`/admin/promo/campaigns/${encodeURIComponent(id)}/enabled`),
      { method: 'POST', requiresAuth: true, body: { enabled } }
    )
  );
  return response.campaign;
}

export async function archiveAdminCampaign(id: string): Promise<PromoCampaign> {
  const response = await unwrap(
    coreCloudClient.request<{ success: boolean; campaign: PromoCampaign }>(
      apiUrl(`/admin/promo/campaigns/${encodeURIComponent(id)}/archive`),
      { method: 'POST', requiresAuth: true, body: {} }
    )
  );
  return response.campaign;
}

export type PromoReconciliation = {
  success?: boolean;
  /** Whether the Paystack balance could actually be read. No balance means no answer. */
  balanceKnown?: boolean;
  availableBalanceKobo?: number | null;
  /** What held escrow owes sellers, in kobo. */
  sellerOwedKobo?: number;
  /** Payouts already committed but not yet sent. */
  committedPayoutsKobo?: number;
  /** Promo money promised to buyers but not yet spent. */
  unspentBudgetKobo?: number;
  requiredKobo?: number;
  shortfallKobo?: number | null;
  /** Fails closed: an unreadable balance is not fundable. */
  fundable?: boolean;
};

export async function getPromoReconciliation(): Promise<PromoReconciliation> {
  return unwrap(
    coreCloudClient.request<PromoReconciliation>(apiUrl('/admin/promo/reconciliation'), {
      method: 'GET',
      requiresAuth: true,
    })
  );
}

export async function getPromoReport(input?: {
  since?: string;
  until?: string;
}): Promise<{ report: Record<string, unknown>; reconciliation: PromoReconciliation }> {
  const params = new URLSearchParams();
  if (input?.since) params.set('since', input.since);
  if (input?.until) params.set('until', input.until);
  const query = params.toString();
  return unwrap(
    coreCloudClient.request<{
      success: boolean;
      report: Record<string, unknown>;
      reconciliation: PromoReconciliation;
    }>(apiUrl(`/admin/promo/report${query ? `?${query}` : ''}`), {
      method: 'GET',
      requiresAuth: true,
    })
  );
}

// ─── Formatting the form needs ──────────────────────────────────────────────
//
// Basis points and kobo are right for the database and unreadable for a person.
// These convert at the edges only, so the numbers on screen are Naira and percent
// and the numbers on the wire stay exact.

export function bpsToPercent(bps: number): number {
  return Math.round((Number(bps) || 0) / 100);
}

export function percentToBps(percent: number): number {
  return Math.round((Number(percent) || 0) * 100);
}

export function koboToNaira(kobo: number | null | undefined): number {
  return Math.round((Number(kobo) || 0) / 100);
}

export function nairaToKobo(naira: number | null | undefined): number | null {
  if (naira === null || naira === undefined) return null;
  const value = Number(naira);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** A campaign's state in words an operator can act on. */
export function campaignStateLabel(campaign: PromoCampaign): {
  label: string;
  tone: 'live' | 'off' | 'scheduled' | 'ended' | 'archived' | 'exhausted';
} {
  if (campaign.archivedAt) return { label: 'Archived', tone: 'archived' };
  const now = Date.now();
  if (campaign.endsAt && new Date(campaign.endsAt).getTime() <= now) {
    return { label: 'Ended', tone: 'ended' };
  }
  if (campaign.startsAt && new Date(campaign.startsAt).getTime() > now) {
    return { label: 'Scheduled', tone: 'scheduled' };
  }
  if (
    campaign.budgetKobo > 0 &&
    typeof campaign.remainingKobo === 'number' &&
    campaign.remainingKobo <= 0
  ) {
    return { label: 'Budget used up', tone: 'exhausted' };
  }
  if (campaign.enabled) return { label: 'Live', tone: 'live' };
  return { label: 'Off', tone: 'off' };
}
