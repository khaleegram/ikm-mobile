import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { payoutsApi } from '@/lib/api/payouts';
import { useUser } from '@/lib/firebase/auth/use-user';
import { usePlatformSettings } from '@/lib/firebase/firestore/platform-settings';
import { useSellerPayouts } from '@/lib/firebase/firestore/payouts';
import { useStore } from '@/lib/firebase/firestore/stores';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { useTheme } from '@/lib/theme/theme-context';
import { NIGERIAN_BANKS, searchBanks } from '@/lib/utils/banks';
import { haptics } from '@/lib/utils/haptics';

const lightBrown = '#A67C52';

type BankFormState = {
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
};

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as any)?.toDate === 'function') return (value as any).toDate();
  return null;
}

export default function MarketPayoutsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { payouts, loading } = useSellerPayouts(user?.uid || null);
  const { store } = useStore(user?.uid || null);
  const { user: profile } = useUserProfile(user?.uid || null);
  const { settings: platformSettings } = usePlatformSettings();

  const [bankModalVisible, setBankModalVisible] = useState(false);
  const [payoutModalVisible, setPayoutModalVisible] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [resolvingAccount, setResolvingAccount] = useState(false);
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [bankSearch, setBankSearch] = useState('');
  const [showBankOptions, setShowBankOptions] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [formData, setFormData] = useState<BankFormState>({
    bankName: '',
    bankCode: '',
    accountNumber: '',
    accountName: '',
  });

  const payoutDetails = store?.payoutDetails || profile?.payoutDetails;
  const hasBankDetails = Boolean(
    payoutDetails?.bankName && payoutDetails?.bankCode && payoutDetails?.accountName && payoutDetails?.accountNumber
  );

  useEffect(() => {
    if (!payoutDetails) return;
    setFormData({
      bankName: payoutDetails.bankName || '',
      bankCode: payoutDetails.bankCode || '',
      accountNumber: payoutDetails.accountNumber || '',
      accountName: payoutDetails.accountName || '',
    });
  }, [payoutDetails]);

  const filteredBanks = useMemo(() => {
    if (!bankSearch.trim()) return NIGERIAN_BANKS;
    return searchBanks(bankSearch.trim());
  }, [bankSearch]);

  const handleSelectBank = (name: string, code: string) => {
    setFormData((prev) => ({ ...prev, bankName: name, bankCode: code, accountName: '' }));
    setShowBankOptions(false);
    setBankSearch('');
  };

  const handleAccountChange = (value: string) => {
    const sanitized = value.replace(/[^0-9]/g, '').slice(0, 10);
    setFormData((prev) => ({
      ...prev,
      accountNumber: sanitized,
      ...(sanitized.length < 10 ? { accountName: '' } : null),
    }));
  };

  const handleResolveAccount = useCallback(async () => {
    if (formData.accountNumber.length !== 10 || !formData.bankCode) return;

    try {
      setResolvingAccount(true);
      const result = await payoutsApi.resolveAccountNumber(formData.accountNumber, formData.bankCode);
      setFormData((prev) => ({ ...prev, accountName: result.accountName || prev.accountName }));
    } catch (error: any) {
      Alert.alert('Resolve failed', error?.message || 'Unable to verify account number.');
    } finally {
      setResolvingAccount(false);
    }
  }, [formData.accountNumber, formData.bankCode]);

  useEffect(() => {
    if (formData.accountNumber.length === 10 && formData.bankCode && !formData.accountName) {
      void handleResolveAccount();
    }
  }, [formData.accountName, formData.accountNumber, formData.bankCode, handleResolveAccount]);

  const handleSaveBankDetails = async () => {
    if (!user) return;
    if (!formData.bankName || !formData.bankCode || formData.accountNumber.length !== 10 || !formData.accountName) {
      Alert.alert('Missing fields', 'Complete bank, account number, and account name first.');
      return;
    }

    try {
      setSavingBank(true);
      haptics.medium();
      await payoutsApi.savePayoutDetails(user.uid, {
        bankName: formData.bankName,
        bankCode: formData.bankCode,
        accountNumber: formData.accountNumber,
        accountName: formData.accountName,
      });
      haptics.success();
      Alert.alert('Saved', 'Payout details updated successfully.');
      setBankModalVisible(false);
    } catch (error: any) {
      haptics.error();
      Alert.alert('Save failed', error?.message || 'Unable to save payout details.');
    } finally {
      setSavingBank(false);
    }
  };

  const handleRequestPayout = async () => {
    if (!user) return;
    const amount = Number(payoutAmount);
    const minAmount = platformSettings?.minPayoutAmount || 10000;

    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Invalid amount', 'Enter a valid payout amount.');
      return;
    }
    if (amount < minAmount) {
      Alert.alert('Amount too low', `Minimum payout is NGN ${minAmount.toLocaleString()}.`);
      return;
    }
    if (!hasBankDetails) {
      Alert.alert('Bank account required', 'Set up your payout bank account first.');
      setBankModalVisible(true);
      return;
    }

    try {
      setRequestingPayout(true);
      haptics.medium();
      await payoutsApi.requestPayout(user.uid, amount);
      haptics.success();
      Alert.alert('Submitted', 'Payout request submitted.');
      setPayoutAmount('');
      setPayoutModalVisible(false);
    } catch (error: any) {
      haptics.error();
      Alert.alert('Request failed', error?.message || 'Unable to request payout right now.');
    } finally {
      setRequestingPayout(false);
    }
  };

  if (!user) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <IconSymbol name="dollarsign.circle.fill" size={48} color={lightBrown} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Sign in required</Text>
        <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
          You must sign in to manage payout settings.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => {
            haptics.light();
            router.back();
          }}>
          <IconSymbol name="arrow.left" size={18} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerIsland}>
          <Text style={styles.headerLabel}>MARKET STREET</Text>
          <Text style={styles.headerTitle}>Payouts</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: insets.bottom + 90,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Bank Account</Text>
            {hasBankDetails && (
              <View style={[styles.statusBadge, { backgroundColor: '#10B98120' }]}>
                <Text style={[styles.statusBadgeText, { color: '#10B981' }]}>Configured</Text>
              </View>
            )}
          </View>
          {hasBankDetails ? (
            <>
              <Text style={[styles.infoLine, { color: colors.text }]}>{payoutDetails?.bankName}</Text>
              <Text style={[styles.infoLine, { color: colors.textSecondary }]}>
                {payoutDetails?.accountNumber?.replace(/\d(?=\d{4})/g, '*')}
              </Text>
              <Text style={[styles.infoLine, { color: colors.textSecondary }]}>{payoutDetails?.accountName}</Text>
            </>
          ) : (
            <Text style={[styles.infoLine, { color: colors.textSecondary }]}>
              No payout account configured yet.
            </Text>
          )}
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: lightBrown }]}
            onPress={() => setBankModalVisible(true)}>
            <Text style={styles.actionButtonText}>{hasBankDetails ? 'Update Bank Details' : 'Set Up Bank Details'}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Request Payout</Text>
          <Text style={[styles.infoLine, { color: colors.textSecondary }]}>
            Minimum payout: NGN {(platformSettings?.minPayoutAmount || 10000).toLocaleString()}
          </Text>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: lightBrown, opacity: hasBankDetails ? 1 : 0.6 }]}
            disabled={!hasBankDetails}
            onPress={() => setPayoutModalVisible(true)}>
            <Text style={styles.actionButtonText}>Request Payout</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>History</Text>
          {loading ? (
            <ActivityIndicator size="small" color={lightBrown} />
          ) : payouts.length === 0 ? (
            <Text style={[styles.infoLine, { color: colors.textSecondary }]}>No payout records yet.</Text>
          ) : (
            payouts.map((payout) => {
              const requestedAt = toDate(payout.requestedAt);
              const status = payout.status || 'pending';
              const statusColor =
                status === 'completed'
                  ? '#10B981'
                  : status === 'failed' || status === 'cancelled'
                    ? '#EF4444'
                    : '#F59E0B';

              return (
                <View key={payout.id} style={[styles.historyItem, { borderTopColor: colors.border }]}>
                  <View style={styles.historyTopRow}>
                    <Text style={[styles.historyAmount, { color: colors.text }]}>
                      NGN {Number(payout.amount || 0).toLocaleString()}
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
                      <Text style={[styles.statusBadgeText, { color: statusColor }]}>{status.toUpperCase()}</Text>
                    </View>
                  </View>
                  <Text style={[styles.historyDate, { color: colors.textSecondary }]}>
                    {requestedAt ? requestedAt.toLocaleString() : 'Recently'}
                  </Text>
                  {payout.failureReason ? (
                    <Text style={[styles.historyError, { color: '#EF4444' }]}>{payout.failureReason}</Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <Modal visible={bankModalVisible} transparent animationType="slide" onRequestClose={() => setBankModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Bank Details</Text>
              <TouchableOpacity onPress={() => setBankModalVisible(false)}>
                <IconSymbol name="xmark.circle.fill" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Account Number</Text>
            <TextInput
              value={formData.accountNumber}
              onChangeText={handleAccountChange}
              placeholder="10-digit account number"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}
            />

            <Text style={[styles.inputLabel, styles.spacingTop, { color: colors.textSecondary }]}>Bank</Text>
            <TouchableOpacity
              style={[
                styles.input,
                styles.selectInput,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}
              onPress={() => setShowBankOptions((prev) => !prev)}>
              <Text
                style={[
                  styles.selectInputText,
                  { color: formData.bankName ? colors.text : colors.textSecondary },
                ]}>
                {formData.bankName || 'Select bank'}
              </Text>
              <IconSymbol name="chevron.down" size={16} color={colors.textSecondary} />
            </TouchableOpacity>

            {showBankOptions ? (
              <View style={[styles.bankPickerCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <TextInput
                  value={bankSearch}
                  onChangeText={setBankSearch}
                  placeholder="Search bank..."
                  placeholderTextColor={colors.textSecondary}
                  style={[
                    styles.bankSearchInput,
                    {
                      color: colors.text,
                      borderColor: colors.border,
                      backgroundColor: colors.backgroundSecondary,
                    },
                  ]}
                />
                <FlatList
                  data={filteredBanks}
                  keyExtractor={(item) => item.code}
                  nestedScrollEnabled
                  style={{ maxHeight: 180 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.bankItem, { borderBottomColor: colors.border }]}
                      onPress={() => handleSelectBank(item.name, item.code)}>
                      <Text style={[styles.bankItemName, { color: colors.text }]}>{item.name}</Text>
                      <Text style={[styles.bankItemCode, { color: colors.textSecondary }]}>{item.code}</Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            ) : null}

            <Text style={[styles.inputLabel, styles.spacingTop, { color: colors.textSecondary }]}>Account Name</Text>
            <View
              style={[
                styles.input,
                styles.selectInput,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}>
              <Text style={[styles.selectInputText, { color: formData.accountName ? colors.text : colors.textSecondary }]}>
                {formData.accountName || 'Will auto-fill after bank verification'}
              </Text>
              {resolvingAccount ? (
                <ActivityIndicator size="small" color={lightBrown} />
              ) : (
                <TouchableOpacity onPress={() => void handleResolveAccount()}>
                  <IconSymbol name="arrow.clockwise" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: lightBrown, marginTop: 14, opacity: savingBank ? 0.6 : 1 }]}
              disabled={savingBank}
              onPress={() => void handleSaveBankDetails()}>
              {savingBank ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.actionButtonText}>Save Details</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={payoutModalVisible} transparent animationType="slide" onRequestClose={() => setPayoutModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Request Payout</Text>
              <TouchableOpacity onPress={() => setPayoutModalVisible(false)}>
                <IconSymbol name="xmark.circle.fill" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Amount (NGN)</Text>
            <TextInput
              value={payoutAmount}
              onChangeText={setPayoutAmount}
              keyboardType="numeric"
              placeholder="Enter payout amount"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}
            />
            <Text style={[styles.infoLine, { color: colors.textSecondary }]}>
              Minimum: NGN {(platformSettings?.minPayoutAmount || 10000).toLocaleString()}
            </Text>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: lightBrown, marginTop: 8, opacity: requestingPayout ? 0.6 : 1 }]}
              disabled={requestingPayout}
              onPress={() => void handleRequestPayout()}>
              {requestingPayout ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.actionButtonText}>Submit Request</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 2,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIsland: {
    flex: 1,
    backgroundColor: lightBrown,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  headerLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  infoLine: {
    fontSize: 13,
    fontWeight: '600',
  },
  actionButton: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  historyItem: {
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 2,
    gap: 2,
  },
  historyTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyAmount: {
    fontSize: 16,
    fontWeight: '800',
  },
  historyDate: {
    fontSize: 12,
    fontWeight: '600',
  },
  historyError: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
    gap: 6,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  spacingTop: {
    marginTop: 6,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  selectInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectInputText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  bankPickerCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
  },
  bankSearchInput: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 10,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '600',
  },
  bankItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  bankItemName: {
    fontSize: 13,
    fontWeight: '700',
  },
  bankItemCode: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
});
