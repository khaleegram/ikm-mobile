// Admin: promo campaigns.
//
// A campaign is a row, not a build. Everything an operator needs to start, cap,
// pause or retire an offer lives here, and the checkout reads the same row — so a
// campaign goes live the moment it is switched on, with no deploy.
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import KeyboardScreen from '@/components/layout/KeyboardScreen';
import { Alert } from '@/components/app-alert';
import { showToast } from '@/components/toast';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  bpsToPercent,
  campaignStateLabel,
  koboToNaira,
  nairaToKobo,
  percentToBps,
  type CampaignFields,
  type CampaignInput,
  type PromoCampaign,
} from '@/lib/api/promo-admin';
import {
  useAdminCampaigns,
  useArchiveCampaign,
  useCreateCampaign,
  usePromoReconciliation,
  useSetCampaignEnabled,
  useUpdateCampaign,
} from '@/lib/hooks/use-admin-promos';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';

const ACCENT = '#A67C52';

const TONE: Record<string, string> = {
  live: '#10B981',
  off: '#9CA3AF',
  scheduled: '#3B82F6',
  ended: '#9CA3AF',
  archived: '#9CA3AF',
  exhausted: '#F59E0B',
};

function naira(value: number | null | undefined): string {
  return `NGN ${Number(value || 0).toLocaleString()}`;
}

/**
 * The offer in one line, in the terms a buyer will read it in.
 *
 * The discount is always the *smaller* of the advertised percentage and the cap, so
 * the cap is the number that decides most orders and has to be visible here.
 */
function describeOffer(campaign: PromoCampaign): string {
  const percent = bpsToPercent(campaign.discountBps);
  if (campaign.capFlatKobo != null) {
    return `${percent}% off, up to ${naira(koboToNaira(campaign.capFlatKobo))}`;
  }
  const cap = bpsToPercent(campaign.capBps);
  return `${percent}% off, capped at ${cap}% of the item (${naira(
    koboToNaira(campaign.capFloorKobo)
  )}–${naira(koboToNaira(campaign.capCeilingKobo))})`;
}

function describeConditions(campaign: PromoCampaign): string[] {
  const conditions: string[] = [];
  if (campaign.firstOrderOnly) conditions.push('First order only');
  if (campaign.minOrderKobo > 0) {
    conditions.push(`Min order ${naira(koboToNaira(campaign.minOrderKobo))}`);
  }
  if (campaign.requiresTicket) {
    conditions.push(
      `Needs a ticket at ${naira(koboToNaira(campaign.ticketThresholdKobo))} or more`
    );
  }
  if (campaign.maxRedemptions != null) {
    conditions.push(`${campaign.maxRedemptions} uses total`);
  }
  if (campaign.maxRedemptionsPerIdentity != null) {
    conditions.push(`${campaign.maxRedemptionsPerIdentity} per person`);
  }
  if (campaign.perSellerCapKobo != null) {
    conditions.push(`${naira(koboToNaira(campaign.perSellerCapKobo))} per seller`);
  }
  if (campaign.dailyPacingKobo != null) {
    conditions.push(`${naira(koboToNaira(campaign.dailyPacingKobo))} a day`);
  }
  if (campaign.endsAt) {
    conditions.push(`Ends ${new Date(campaign.endsAt).toLocaleDateString()}`);
  } else if (campaign.startsAt) {
    conditions.push(`Starts ${new Date(campaign.startsAt).toLocaleDateString()}`);
  }
  return conditions;
}

type Draft = {
  code: string;
  name: string;
  description: string;
  discountPercent: string;
  capMode: 'percent' | 'flat';
  capPercent: string;
  capFloorNaira: string;
  capCeilingNaira: string;
  capFlatNaira: string;
  firstOrderOnly: boolean;
  minOrderNaira: string;
  requiresTicket: boolean;
  ticketThresholdNaira: string;
  budgetNaira: string;
  dailyPacingNaira: string;
  perSellerCapNaira: string;
  maxRedemptions: string;
  maxRedemptionsPerIdentity: string;
  startsAt: string;
  endsAt: string;
  releaseWindowDays: string;
};

const BLANK_DRAFT: Draft = {
  code: '',
  name: '',
  description: '',
  discountPercent: '15',
  capMode: 'percent',
  capPercent: '5',
  capFloorNaira: '2000',
  capCeilingNaira: '15000',
  capFlatNaira: '2000',
  firstOrderOnly: true,
  minOrderNaira: '0',
  requiresTicket: false,
  ticketThresholdNaira: '5000',
  budgetNaira: '0',
  dailyPacingNaira: '',
  perSellerCapNaira: '',
  maxRedemptions: '',
  maxRedemptionsPerIdentity: '',
  startsAt: '',
  endsAt: '',
  releaseWindowDays: '7',
};

function draftFrom(campaign: PromoCampaign): Draft {
  return {
    code: campaign.code,
    name: campaign.name,
    description: campaign.description || '',
    discountPercent: String(bpsToPercent(campaign.discountBps)),
    capMode: campaign.capFlatKobo != null ? 'flat' : 'percent',
    capPercent: String(bpsToPercent(campaign.capBps)),
    capFloorNaira: String(koboToNaira(campaign.capFloorKobo)),
    capCeilingNaira: String(koboToNaira(campaign.capCeilingKobo)),
    capFlatNaira: String(koboToNaira(campaign.capFlatKobo ?? 200000)),
    firstOrderOnly: campaign.firstOrderOnly,
    minOrderNaira: String(koboToNaira(campaign.minOrderKobo)),
    requiresTicket: campaign.requiresTicket,
    ticketThresholdNaira: String(koboToNaira(campaign.ticketThresholdKobo)),
    budgetNaira: String(koboToNaira(campaign.budgetKobo)),
    dailyPacingNaira:
      campaign.dailyPacingKobo == null ? '' : String(koboToNaira(campaign.dailyPacingKobo)),
    perSellerCapNaira:
      campaign.perSellerCapKobo == null ? '' : String(koboToNaira(campaign.perSellerCapKobo)),
    maxRedemptions: campaign.maxRedemptions == null ? '' : String(campaign.maxRedemptions),
    maxRedemptionsPerIdentity:
      campaign.maxRedemptionsPerIdentity == null ? '' : String(campaign.maxRedemptionsPerIdentity),
    startsAt: campaign.startsAt ? String(campaign.startsAt).slice(0, 10) : '',
    endsAt: campaign.endsAt ? String(campaign.endsAt).slice(0, 10) : '',
    releaseWindowDays: String(campaign.releaseWindowDays ?? 7),
  };
}

function optionalKobo(value: string): number | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return nairaToKobo(Number(trimmed));
}

function optionalInt(value: string): number | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/** Turn the form into the shape the API takes. Money becomes kobo exactly once. */
function draftToInput(draft: Draft): CampaignFields {
  const input: CampaignFields = {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    discountBps: percentToBps(Number(draft.discountPercent)),
    capBps: percentToBps(Number(draft.capPercent)),
    capFloorKobo: nairaToKobo(Number(draft.capFloorNaira)) ?? 0,
    capCeilingKobo: nairaToKobo(Number(draft.capCeilingNaira)) ?? 0,
    capFlatKobo:
      draft.capMode === 'flat' ? nairaToKobo(Number(draft.capFlatNaira)) ?? 0 : null,
    firstOrderOnly: draft.firstOrderOnly,
    minOrderKobo: nairaToKobo(Number(draft.minOrderNaira)) ?? 0,
    requiresTicket: draft.requiresTicket,
    ticketThresholdKobo: nairaToKobo(Number(draft.ticketThresholdNaira)) ?? 0,
    budgetKobo: nairaToKobo(Number(draft.budgetNaira)) ?? 0,
    dailyPacingKobo: optionalKobo(draft.dailyPacingNaira),
    perSellerCapKobo: optionalKobo(draft.perSellerCapNaira),
    maxRedemptions: optionalInt(draft.maxRedemptions),
    maxRedemptionsPerIdentity: optionalInt(draft.maxRedemptionsPerIdentity),
    releaseWindowDays: optionalInt(draft.releaseWindowDays) ?? 7,
  };
  if (draft.startsAt.trim()) input.startsAt = draft.startsAt.trim();
  if (draft.endsAt.trim()) input.endsAt = draft.endsAt.trim();
  return input;
}

function draftToNewCampaign(draft: Draft): CampaignInput {
  return {
    ...draftToInput(draft),
    code: draft.code.trim().toUpperCase(),
    name: draft.name.trim(),
  };
}

export default function AdminPromosScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<PromoCampaign | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);
  const [busyId, setBusyId] = useState<string | null>(null);

  const campaigns = useAdminCampaigns({ includeArchived });
  const reconciliation = usePromoReconciliation();
  const setEnabled = useSetCampaignEnabled();
  const archive = useArchiveCampaign();
  const create = useCreateCampaign();
  const update = useUpdateCampaign();

  const list = useMemo(() => campaigns.data ?? [], [campaigns.data]);
  const saving = create.isPending || update.isPending;

  const openCreate = () => {
    haptics.light();
    setEditing(null);
    setDraft(BLANK_DRAFT);
    setFormOpen(true);
  };

  const openEdit = (campaign: PromoCampaign) => {
    haptics.light();
    setEditing(campaign);
    setDraft(draftFrom(campaign));
    setFormOpen(true);
  };

  const onSave = async () => {
    if (!draft.code.trim() && !editing) {
      showToast('A code is required — buyers type it at checkout.', 'error');
      return;
    }
    if (!draft.name.trim()) {
      showToast('Name this campaign so it can be recognised later.', 'error');
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          patch: draftToInput(draft),
        });
        showToast('Campaign updated.', 'success');
      } else {
        await create.mutateAsync(draftToNewCampaign(draft));
        showToast('Campaign created. Switch it on when you are ready.', 'success');
      }
      haptics.success();
      setFormOpen(false);
    } catch (error: any) {
      showToast(error?.message || 'Could not save that campaign.', 'error');
    }
  };

  const onToggle = async (campaign: PromoCampaign, enabled: boolean) => {
    haptics.light();
    setBusyId(campaign.id);
    try {
      await setEnabled.mutateAsync({ id: campaign.id, enabled });
      showToast(enabled ? `${campaign.code} is live.` : `${campaign.code} is off.`, 'success');
    } catch (error: any) {
      showToast(error?.message || 'Could not change that campaign.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onArchive = (campaign: PromoCampaign) => {
    Alert.alert(
      'Archive this campaign?',
      `${campaign.code} stops being usable and is hidden from the list. Orders already placed under it keep their discount.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusyId(campaign.id);
              try {
                await archive.mutateAsync(campaign.id);
                showToast('Campaign archived.', 'success');
              } catch (error: any) {
                showToast(error?.message || 'Could not archive that campaign.', 'error');
              } finally {
                setBusyId(null);
              }
            })();
          },
        },
      ]
    );
  };

  /** The one number that says whether promo money can still be given away (§6.3). */
  const funding = reconciliation.data;
  const fundingWarning = funding && funding.success !== false && funding.balanceKnown === false;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <IconSymbol name="arrow.left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Promo campaigns</Text>
        <TouchableOpacity onPress={openCreate} style={styles.headerBtn} hitSlop={12}>
          <IconSymbol name="plus" size={22} color={ACCENT} />
        </TouchableOpacity>
      </View>

      {fundingWarning ? (
        <View
          style={[
            styles.banner,
            { backgroundColor: '#F59E0B18', borderColor: '#F59E0B44' },
          ]}>
          <IconSymbol name="exclamationmark.triangle.fill" size={16} color="#F59E0B" />
          <Text style={[styles.bannerText, { color: colors.text }]}>
            The payouts balance could not be read, so promos are being refused at checkout
            until it can. Switching one on will not make it apply.
          </Text>
        </View>
      ) : null}

      {campaigns.isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={ACCENT} />
      ) : campaigns.isError ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary, fontWeight: '600', textAlign: 'center' }}>
            {(campaigns.error as any)?.message || 'Could not load campaigns.'}
          </Text>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: ACCENT, marginTop: 16 }]}
            onPress={() => void campaigns.refetch()}>
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 12 }}
          ListHeaderComponent={
            <TouchableOpacity
              style={styles.archiveToggle}
              onPress={() => {
                haptics.light();
                setIncludeArchived((value) => !value);
              }}>
              <IconSymbol
                name={includeArchived ? 'checkmark.square.fill' : 'square'}
                size={18}
                color={includeArchived ? ACCENT : colors.textSecondary}
              />
              <Text style={{ color: colors.textSecondary, fontWeight: '700', fontSize: 13 }}>
                Show archived
              </Text>
            </TouchableOpacity>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No campaigns yet</Text>
              <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 6 }}>
                Create one and it becomes usable at checkout the moment you switch it on.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const state = campaignStateLabel(item);
            const tone = TONE[state.tone] || ACCENT;
            const budget = item.budgetKobo;
            const spent = item.spentKobo || 0;
            const progress = budget > 0 ? Math.min(1, spent / budget) : 0;
            const conditions = describeConditions(item);
            const isBusy = busyId === item.id;

            return (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardTop}>
                  <View style={[styles.codeChip, { backgroundColor: `${ACCENT}18`, borderColor: `${ACCENT}44` }]}>
                    <Text style={[styles.codeText, { color: ACCENT }]}>{item.code}</Text>
                  </View>
                  <View style={[styles.pill, { backgroundColor: `${tone}22` }]}>
                    <Text style={{ color: tone, fontWeight: '800', fontSize: 11 }}>{state.label}</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <Switch
                    value={Boolean(item.enabled) && !item.archivedAt}
                    disabled={Boolean(item.archivedAt) || isBusy}
                    onValueChange={(next) => void onToggle(item, next)}
                    trackColor={{ false: colors.border, true: `${ACCENT}66` }}
                    thumbColor={item.enabled ? ACCENT : undefined}
                  />
                </View>

                <Text style={[styles.name, { color: colors.text }]}>{item.name}</Text>
                {item.description ? (
                  <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
                    {item.description}
                  </Text>
                ) : null}

                <Text style={[styles.offer, { color: colors.text }]}>{describeOffer(item)}</Text>

                {conditions.length ? (
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 18 }}>
                    {conditions.join(' · ')}
                  </Text>
                ) : null}

                {budget > 0 ? (
                  <View style={{ marginTop: 12 }}>
                    <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${Math.round(progress * 100)}%`, backgroundColor: tone },
                        ]}
                      />
                    </View>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6, fontWeight: '600' }}>
                      {naira(koboToNaira(spent))} given away of {naira(koboToNaira(budget))} ·{' '}
                      {naira(koboToNaira(Math.max(0, item.remainingKobo ?? budget - spent)))} left
                    </Text>
                  </View>
                ) : (
                  <Text style={{ color: '#F59E0B', fontSize: 12, marginTop: 10, fontWeight: '700' }}>
                    No budget set — this cannot apply until one is added.
                  </Text>
                )}

                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.smallBtn, { borderColor: colors.border }]}
                    onPress={() => openEdit(item)}
                    disabled={isBusy}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Edit</Text>
                  </TouchableOpacity>
                  {!item.archivedAt ? (
                    <TouchableOpacity
                      style={[styles.smallBtn, { borderColor: colors.border, opacity: isBusy ? 0.5 : 1 }]}
                      onPress={() => onArchive(item)}
                      disabled={isBusy}>
                      <Text style={{ color: '#B91C1C', fontWeight: '700', fontSize: 13 }}>Archive</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          }}
        />
      )}

      <Modal
        visible={formOpen}
        animationType="slide"
        onRequestClose={() => setFormOpen(false)}
        presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 8 }]}>
            <TouchableOpacity
              onPress={() => setFormOpen(false)}
              style={styles.headerBtn}
              hitSlop={12}>
              <Text style={{ color: colors.textSecondary, fontWeight: '700', fontSize: 15 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.title, { color: colors.text }]}>
              {editing ? 'Edit campaign' : 'New campaign'}
            </Text>
            <View style={styles.headerBtn} />
          </View>

          <KeyboardScreen extraScrollHeight={40} contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 14 }}>
            {editing ? null : (
              <Field label="Code" hint="Buyers type this at checkout. Letter and digits." colors={colors}>
                <TextInput
                  value={draft.code}
                  onChangeText={(value) => setDraft((d) => ({ ...d, code: value.toUpperCase() }))}
                  placeholder="AWOOF"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                />
              </Field>
            )}

            <Field label="Name" colors={colors}>
              <TextInput
                value={draft.name}
                onChangeText={(value) => setDraft((d) => ({ ...d, name: value }))}
                placeholder="Awoof launch"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              />
            </Field>

            <Field label="Description" hint="Shown to the buyer beside the code. Optional." colors={colors}>
              <TextInput
                value={draft.description}
                onChangeText={(value) => setDraft((d) => ({ ...d, description: value }))}
                placeholder="15% off your first order"
                placeholderTextColor={colors.textSecondary}
                multiline
                style={[
                  styles.input,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.card, height: 70 },
                ]}
              />
            </Field>

            <Field label="Discount %" hint="Taken off the items, never off delivery." colors={colors}>
              <TextInput
                value={draft.discountPercent}
                onChangeText={(value) => setDraft((d) => ({ ...d, discountPercent: value }))}
                keyboardType="numeric"
                placeholder="15"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              />
            </Field>

            <Field
              label="Cap"
              hint="The discount is whichever is smaller: the percentage, or this cap."
              colors={colors}>
              <View style={styles.segment}>
                {(['percent', 'flat'] as const).map((mode) => {
                  const active = draft.capMode === mode;
                  return (
                    <TouchableOpacity
                      key={mode}
                      onPress={() => setDraft((d) => ({ ...d, capMode: mode }))}
                      style={[
                        styles.segmentBtn,
                        {
                          backgroundColor: active ? `${ACCENT}22` : 'transparent',
                          borderColor: active ? ACCENT : colors.border,
                        },
                      ]}>
                      <Text
                        style={{
                          color: active ? ACCENT : colors.textSecondary,
                          fontWeight: '700',
                          fontSize: 13,
                        }}>
                        {mode === 'percent' ? 'Percent of item' : 'Flat amount'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {draft.capMode === 'percent' ? (
                <View style={{ gap: 10, marginTop: 10 }}>
                  <LabeledInput
                    label="Cap % of item"
                    value={draft.capPercent}
                    onChange={(value) => setDraft((d) => ({ ...d, capPercent: value }))}
                    placeholder="5"
                    colors={colors}
                  />
                  <LabeledInput
                    label="Never below (NGN)"
                    value={draft.capFloorNaira}
                    onChange={(value) => setDraft((d) => ({ ...d, capFloorNaira: value }))}
                    placeholder="2000"
                    colors={colors}
                  />
                  <LabeledInput
                    label="Never above (NGN)"
                    value={draft.capCeilingNaira}
                    onChange={(value) => setDraft((d) => ({ ...d, capCeilingNaira: value }))}
                    placeholder="15000"
                    colors={colors}
                  />
                </View>
              ) : (
                <View style={{ marginTop: 10 }}>
                  <LabeledInput
                    label="Flat amount off (NGN)"
                    value={draft.capFlatNaira}
                    onChange={(value) => setDraft((d) => ({ ...d, capFlatNaira: value }))}
                    placeholder="2000"
                    colors={colors}
                  />
                </View>
              )}
            </Field>

            <Field
              label="Budget (NGN)"
              hint="The most this campaign will ever give away. Required — an unbudgeted campaign cannot apply."
              colors={colors}>
              <TextInput
                value={draft.budgetNaira}
                onChangeText={(value) => setDraft((d) => ({ ...d, budgetNaira: value }))}
                keyboardType="numeric"
                placeholder="100000"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              />
            </Field>

            <Field label="Limits" colors={colors}>
              <View style={{ gap: 10 }}>
                <LabeledInput
                  label="Minimum order (NGN)"
                  value={draft.minOrderNaira}
                  onChange={(value) => setDraft((d) => ({ ...d, minOrderNaira: value }))}
                  placeholder="0"
                  colors={colors}
                />
                <LabeledInput
                  label="Spend a day, at most (NGN)"
                  value={draft.dailyPacingNaira}
                  onChange={(value) => setDraft((d) => ({ ...d, dailyPacingNaira: value }))}
                  placeholder="Leave empty for no limit"
                  colors={colors}
                />
                <LabeledInput
                  label="Per seller, at most (NGN)"
                  value={draft.perSellerCapNaira}
                  onChange={(value) => setDraft((d) => ({ ...d, perSellerCapNaira: value }))}
                  placeholder="Leave empty for no limit"
                  colors={colors}
                />
                <LabeledInput
                  label="Uses in total"
                  value={draft.maxRedemptions}
                  onChange={(value) => setDraft((d) => ({ ...d, maxRedemptions: value }))}
                  placeholder="Leave empty for no limit"
                  colors={colors}
                />
                <LabeledInput
                  label="Uses per person"
                  value={draft.maxRedemptionsPerIdentity}
                  onChange={(value) => setDraft((d) => ({ ...d, maxRedemptionsPerIdentity: value }))}
                  placeholder="Leave empty for no limit"
                  colors={colors}
                />
              </View>
            </Field>

            <Toggle
              label="First order only"
              hint="Only buyers who have never ordered. The strongest guard against resellers."
              value={draft.firstOrderOnly}
              onChange={(value) => setDraft((d) => ({ ...d, firstOrderOnly: value }))}
              colors={colors}
            />

            <Toggle
              label="Requires an earlier purchase"
              hint="Only buyers who have already spent the threshold below."
              value={draft.requiresTicket}
              onChange={(value) => setDraft((d) => ({ ...d, requiresTicket: value }))}
              colors={colors}
            />
            {draft.requiresTicket ? (
              <LabeledInput
                label="Ticket threshold (NGN)"
                value={draft.ticketThresholdNaira}
                onChange={(value) => setDraft((d) => ({ ...d, ticketThresholdNaira: value }))}
                placeholder="5000"
                colors={colors}
              />
            ) : null}

            <Field label="Schedule" hint="Leave empty to run for as long as it is switched on." colors={colors}>
              <View style={{ gap: 10 }}>
                <LabeledInput
                  label="Starts (YYYY-MM-DD)"
                  value={draft.startsAt}
                  onChange={(value) => setDraft((d) => ({ ...d, startsAt: value }))}
                  placeholder="Leave empty to start now"
                  colors={colors}
                  autoCapitalize="none"
                />
                <LabeledInput
                  label="Ends (YYYY-MM-DD)"
                  value={draft.endsAt}
                  onChange={(value) => setDraft((d) => ({ ...d, endsAt: value }))}
                  placeholder="Leave empty for no end"
                  colors={colors}
                  autoCapitalize="none"
                />
                <LabeledInput
                  label="Hold the seller's money for (days)"
                  value={draft.releaseWindowDays}
                  onChange={(value) => setDraft((d) => ({ ...d, releaseWindowDays: value }))}
                  placeholder="7"
                  colors={colors}
                />
              </View>
            </Field>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: ACCENT, opacity: saving ? 0.6 : 1 }]}
              disabled={saving}
              onPress={() => void onSave()}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {editing ? 'Save changes' : 'Create campaign'}
                </Text>
              )}
            </TouchableOpacity>

            {editing ? (
              <Text style={{ color: colors.textSecondary, fontSize: 12, textAlign: 'center' }}>
                The code cannot be changed once a campaign exists — buyers may already have it.
              </Text>
            ) : null}
          </KeyboardScreen>
        </View>
      </Modal>
    </View>
  );
}

function Field({
  label,
  hint,
  children,
  colors,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  colors: any;
}) {
  return (
    <View>
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{label}</Text>
      {hint ? (
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2, marginBottom: 8, lineHeight: 17 }}>
          {hint}
        </Text>
      ) : (
        <View style={{ height: 8 }} />
      )}
      {children}
    </View>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  colors,
  autoCapitalize = 'characters' as const,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  colors: any;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View>
      <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        keyboardType="numeric"
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
      />
    </View>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
  colors,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  colors: any;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{label}</Text>
        {hint ? (
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 17 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={(next) => {
          haptics.light();
          onChange(next);
        }}
        trackColor={{ false: colors.border, true: `${ACCENT}66` }}
        thumbColor={value ? ACCENT : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { minWidth: 64, height: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800' },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
  },
  bannerText: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 6, marginTop: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  archiveToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, marginBottom: 4 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codeChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  codeText: { fontWeight: '900', fontSize: 13, letterSpacing: 1 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  name: { fontSize: 15, fontWeight: '800', marginTop: 10 },
  offer: { fontSize: 13.5, fontWeight: '700', marginTop: 8 },
  progressTrack: { height: 6, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 999 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  smallBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  btn: { borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  primaryBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 6 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 },
  segment: { flexDirection: 'row', gap: 8 },
  segmentBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
});
