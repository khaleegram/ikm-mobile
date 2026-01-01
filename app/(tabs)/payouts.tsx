// Modern Payouts management screen with bank account auto-detection
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, FlatList } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState, useEffect, useMemo } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow } from '@/lib/theme/styles';
import { useSellerPayouts } from '@/lib/firebase/firestore/payouts';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useStore } from '@/lib/firebase/firestore/stores';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { payoutsApi } from '@/lib/api/payouts';
import { Payout } from '@/types';
import { usePlatformSettings } from '@/lib/firebase/firestore/platform-settings';
import { NIGERIAN_BANKS, searchBanks, getBankByCode, Bank } from '@/lib/utils/banks';

export default function PayoutsScreen() {
  const { colors, colorScheme } = useTheme();
  const { user } = useUser();
  const { payouts, loading } = useSellerPayouts(user?.uid || null);
  const { store } = useStore(user?.uid || null);
  const { user: userProfile } = useUserProfile(user?.uid || null);
  const { settings: platformSettings } = usePlatformSettings();
  const [bankModalVisible, setBankModalVisible] = useState(false);
  const [payoutModalVisible, setPayoutModalVisible] = useState(false);
  const [resolvingAccount, setResolvingAccount] = useState(false);
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [showBankSearch, setShowBankSearch] = useState(false);
  const [bankSearchQuery, setBankSearchQuery] = useState('');
  const [formData, setFormData] = useState({
    bankName: '',
    bankCode: '',
    accountNumber: '',
    accountName: '',
    bankType: '' as 'commercial' | 'microfinance' | 'merchant' | 'non-interest' | '',
  });
  const [payoutAmount, setPayoutAmount] = useState('');
  const styles = createStyles(colors);

  // Get payout details from either store or user profile (web app might save to users collection)
  useEffect(() => {
    // Check both store and user profile for payout details
    const payoutDetails = store?.payoutDetails || userProfile?.payoutDetails;
    
    if (payoutDetails) {
      const bank = getBankByCode(payoutDetails.bankCode || '');
      setFormData({
        bankName: payoutDetails.bankName || '',
        bankCode: payoutDetails.bankCode || '',
        accountNumber: payoutDetails.accountNumber || '',
        accountName: payoutDetails.accountName || '',
        bankType: bank?.type || '',
      });
    }
  }, [store, userProfile]);

  // Auto-detect bank when account number reaches 10 digits
  useEffect(() => {
    if (formData.accountNumber.length === 10 && !formData.bankCode) {
      // Try to auto-resolve bank from account number
      // This would typically call an API, but for now we'll show bank search
      setShowBankSearch(true);
    }
  }, [formData.accountNumber]);

  // Auto-resolve account name when both account number and bank code are available
  useEffect(() => {
    if (formData.accountNumber.length === 10 && formData.bankCode && !formData.accountName && !resolvingAccount) {
      handleAutoResolveAccount();
    }
  }, [formData.accountNumber, formData.bankCode]);

  const handleAutoResolveAccount = async () => {
    if (!formData.accountNumber || !formData.bankCode || formData.accountNumber.length !== 10) {
      return;
    }

    setResolvingAccount(true);
    try {
      const result = await payoutsApi.resolveAccountNumber(formData.accountNumber, formData.bankCode);
      setFormData({ ...formData, accountName: result.accountName });
    } catch (error: any) {
      // Silent fail - user can still enter manually
      console.log('Auto-resolve failed:', error.message);
    } finally {
      setResolvingAccount(false);
    }
  };

  const handleAccountNumberChange = (text: string) => {
    // Only allow numbers
    const numbersOnly = text.replace(/[^0-9]/g, '');
    // Limit to 10 digits
    const limited = numbersOnly.slice(0, 10);
    setFormData({ ...formData, accountNumber: limited });
    
    // Clear bank info if account number changes
    if (limited.length < 10) {
      setFormData(prev => ({ ...prev, bankCode: '', bankName: '', bankType: '', accountName: '' }));
    }
  };

  const handleBankSelect = (bank: Bank) => {
    setFormData({
      ...formData,
      bankName: bank.name,
      bankCode: bank.code,
      bankType: bank.type,
    });
    setShowBankSearch(false);
    setBankSearchQuery('');
    
    // Auto-resolve account name if account number is 10 digits
    if (formData.accountNumber.length === 10) {
      handleAutoResolveAccount();
    }
  };

  const filteredBanks = useMemo(() => {
    if (!bankSearchQuery) return NIGERIAN_BANKS;
    return searchBanks(bankSearchQuery);
  }, [bankSearchQuery]);

  const handleSaveBankDetails = async () => {
    if (!user || !formData.bankName || !formData.bankCode || !formData.accountNumber || !formData.accountName) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (formData.accountNumber.length !== 10) {
      Alert.alert('Error', 'Account number must be 10 digits');
      return;
    }

    try {
      await payoutsApi.savePayoutDetails(user.uid, {
        bankName: formData.bankName,
        bankCode: formData.bankCode,
        accountNumber: formData.accountNumber,
        accountName: formData.accountName,
      });
      Alert.alert('Success', 'Bank details saved successfully');
      setBankModalVisible(false);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save bank details');
    }
  };

  const handleRequestPayout = async () => {
    if (!user || !payoutAmount) {
      Alert.alert('Error', 'Please enter payout amount');
      return;
    }

    const amount = parseFloat(payoutAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    const minPayout = platformSettings?.minPayoutAmount || 10000;
    if (amount < minPayout) {
      Alert.alert('Error', `Minimum payout amount is ₦${minPayout.toLocaleString()}`);
      return;
    }

    const payoutDetails = store?.payoutDetails || userProfile?.payoutDetails;
    if (!payoutDetails) {
      Alert.alert('Error', 'Please set up your bank account first');
      setBankModalVisible(true);
      return;
    }

    setRequestingPayout(true);
    try {
      // TODO: If you have a requestPayout Cloud Function, add it to cloud-functions.ts
      // For now, this would need to be handled via your backend API or Cloud Function
      throw new Error('Request payout functionality needs a Cloud Function. Please provide the URL if you have one.');
      Alert.alert('Success', 'Payout request submitted successfully');
      setPayoutModalVisible(false);
      setPayoutAmount('');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to request payout');
    } finally {
      setRequestingPayout(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return colors.success;
      case 'processing':
      case 'pending':
        return colors.warning;
      case 'failed':
      case 'cancelled':
        return colors.error;
      default:
        return colors.textSecondary;
    }
  };

  const getBankTypeLabel = (type: string) => {
    switch (type) {
      case 'commercial': return 'Commercial Bank';
      case 'microfinance': return 'Microfinance Bank';
      case 'merchant': return 'Merchant Bank';
      case 'non-interest': return 'Non-Interest Bank';
      default: return '';
    }
  };

  // Check both store and user profile for bank details
  const payoutDetails = store?.payoutDetails || userProfile?.payoutDetails;
  const hasBankDetails = !!(payoutDetails?.accountNumber && payoutDetails?.accountName);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <Text style={[styles.title, { color: colors.text }]}>Payouts</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Bank Account Setup */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Bank Account</Text>
            {hasBankDetails && (
              <View style={[styles.statusBadge, { backgroundColor: `${colors.success}20` }]}>
                <Text style={[styles.statusText, { color: colors.success }]}>CONFIGURED</Text>
              </View>
            )}
          </View>

          {hasBankDetails ? (
            <View style={styles.bankDetails}>
              <View style={styles.bankDetailRow}>
                <Text style={[styles.bankDetailLabel, { color: colors.textSecondary }]}>Bank Name</Text>
                <Text style={[styles.bankDetailValue, { color: colors.text }]}>{payoutDetails?.bankName}</Text>
              </View>
              <View style={styles.bankDetailRow}>
                <Text style={[styles.bankDetailLabel, { color: colors.textSecondary }]}>Account Number</Text>
                <Text style={[styles.bankDetailValue, { color: colors.text }]}>
                  {payoutDetails?.accountNumber?.replace(/\d(?=\d{4})/g, '*')}
                </Text>
              </View>
              <View style={styles.bankDetailRow}>
                <Text style={[styles.bankDetailLabel, { color: colors.textSecondary }]}>Account Name</Text>
                <Text style={[styles.bankDetailValue, { color: colors.text }]}>{payoutDetails?.accountName}</Text>
              </View>
            </View>
          ) : (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Set up your bank account to receive payouts
            </Text>
          )}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={() => setBankModalVisible(true)}>
            <Text style={styles.buttonText}>
              {hasBankDetails ? 'Update Bank Details' : 'Set Up Bank Account'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Request Payout */}
        {hasBankDetails && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Request Payout</Text>
            {platformSettings?.minPayoutAmount && (
              <Text style={[styles.minPayoutText, { color: colors.textSecondary }]}>
                Minimum payout: ₦{platformSettings.minPayoutAmount.toLocaleString()}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={() => setPayoutModalVisible(true)}>
              <IconSymbol name="dollarsign.circle.fill" size={24} color="#fff" />
              <Text style={styles.buttonText}>Request Payout</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Payout History */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Payout History</Text>
          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : payouts.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No payout history</Text>
          ) : (
            payouts.map((payout) => (
              <View key={payout.id} style={styles.payoutItem}>
                <View style={styles.payoutHeader}>
                  <View>
                    <Text style={[styles.payoutAmount, { color: colors.text }]}>
                      ₦{payout.amount.toLocaleString()}
                    </Text>
                    <Text style={[styles.payoutDate, { color: colors.textSecondary }]}>
                      {payout.requestedAt instanceof Date
                        ? payout.requestedAt.toLocaleDateString()
                        : new Date(payout.requestedAt as any).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: `${getStatusColor(payout.status)}20` }]}>
                    <Text style={[styles.statusText, { color: getStatusColor(payout.status) }]}>
                      {payout.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
                {payout.processedAt && (
                  <Text style={[styles.payoutProcessed, { color: colors.textSecondary }]}>
                    Processed: {payout.processedAt instanceof Date
                      ? payout.processedAt.toLocaleDateString()
                      : new Date(payout.processedAt as any).toLocaleDateString()}
                  </Text>
                )}
                {payout.failureReason && (
                  <Text style={[styles.payoutError, { color: colors.error }]}>
                    {payout.failureReason}
                  </Text>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Modern Bank Details Modal */}
      <Modal
        visible={bankModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setBankModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView
            style={[styles.modalContent, { backgroundColor: colors.card }]}
            contentContainerStyle={styles.modalBody}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Bank Account Details</Text>
              <TouchableOpacity
                onPress={() => {
                  setBankModalVisible(false);
                  setShowBankSearch(false);
                  setBankSearchQuery('');
                }}
                style={[styles.closeButton, { backgroundColor: colors.backgroundSecondary }]}>
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Account Number Input - Modern Design */}
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.text }]}>Account Number</Text>
              <View style={[styles.inputContainer, { 
                backgroundColor: colors.backgroundSecondary, 
                borderColor: formData.accountNumber.length === 10 ? colors.success : colors.cardBorder 
              }]}>
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  placeholder="Enter 10-digit account number"
                  placeholderTextColor={colors.textSecondary}
                  value={formData.accountNumber}
                  onChangeText={handleAccountNumberChange}
                  keyboardType="numeric"
                  maxLength={10}
                />
                {formData.accountNumber.length === 10 && (
                  <IconSymbol name="checkmark.circle.fill" size={20} color={colors.success} />
                )}
              </View>
              {formData.accountNumber.length > 0 && formData.accountNumber.length < 10 && (
                <Text style={[styles.hintText, { color: colors.textSecondary }]}>
                  {10 - formData.accountNumber.length} digits remaining
                </Text>
              )}
            </View>

            {/* Bank Selection - Auto-shown when account number is 10 digits */}
            {formData.accountNumber.length === 10 && (
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Select Bank</Text>
                {!formData.bankCode ? (
                  <>
                    <TouchableOpacity
                      style={[styles.bankSelectorButton, { 
                        backgroundColor: colors.backgroundSecondary, 
                        borderColor: colors.cardBorder 
                      }]}
                      onPress={() => setShowBankSearch(!showBankSearch)}>
                      <Text style={[styles.bankSelectorText, { color: colors.textSecondary }]}>
                        Tap to select bank
                      </Text>
                      <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                    
                    {showBankSearch && (
                      <View style={[styles.bankSearchContainer, { backgroundColor: colors.backgroundSecondary }]}>
                        <View style={[styles.searchInputContainer, { borderColor: colors.cardBorder }]}>
                          <IconSymbol name="magnifyingglass" size={20} color={colors.textSecondary} />
                          <TextInput
                            style={[styles.searchInput, { color: colors.text }]}
                            placeholder="Search bank..."
                            placeholderTextColor={colors.textSecondary}
                            value={bankSearchQuery}
                            onChangeText={setBankSearchQuery}
                          />
                        </View>
                        <FlatList
                          data={filteredBanks}
                          keyExtractor={(item) => item.code}
                          renderItem={({ item }) => (
                            <TouchableOpacity
                              style={[styles.bankItem, { borderBottomColor: colors.cardBorder }]}
                              onPress={() => handleBankSelect(item)}>
                              <View style={styles.bankItemContent}>
                                <Text style={[styles.bankItemName, { color: colors.text }]}>{item.name}</Text>
                                <Text style={[styles.bankItemCode, { color: colors.textSecondary }]}>
                                  {item.code} • {getBankTypeLabel(item.type)}
                                </Text>
                              </View>
                              <IconSymbol name="chevron.right" size={20} color={colors.textSecondary} />
                            </TouchableOpacity>
                          )}
                          style={styles.bankList}
                          nestedScrollEnabled
                        />
                      </View>
                    )}
                  </>
                ) : (
                  <View style={[styles.selectedBankCard, { backgroundColor: colors.primary + '20', borderColor: colors.primary }]}>
                    <View style={styles.selectedBankContent}>
                      <View>
                        <Text style={[styles.selectedBankName, { color: colors.text }]}>{formData.bankName}</Text>
                        <Text style={[styles.selectedBankInfo, { color: colors.textSecondary }]}>
                          {formData.bankCode} • {getBankTypeLabel(formData.bankType)}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => {
                          setFormData(prev => ({ ...prev, bankCode: '', bankName: '', bankType: '' }));
                          setShowBankSearch(true);
                        }}>
                        <IconSymbol name="pencil.fill" size={20} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* Account Name - Auto-filled or editable */}
            {formData.bankCode && (
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Account Name</Text>
                <View style={[styles.inputContainer, { 
                  backgroundColor: colors.backgroundSecondary, 
                  borderColor: formData.accountName ? colors.success : colors.cardBorder 
                }]}>
                  <TextInput
                    style={[styles.input, { color: colors.text }]}
                    placeholder="Account name will be auto-filled"
                    placeholderTextColor={colors.textSecondary}
                    value={formData.accountName}
                    onChangeText={(text) => setFormData({ ...formData, accountName: text })}
                    editable={!resolvingAccount}
                  />
                  {resolvingAccount && (
                    <ActivityIndicator size="small" color={colors.primary} />
                  )}
                  {formData.accountName && !resolvingAccount && (
                    <IconSymbol name="checkmark.circle.fill" size={20} color={colors.success} />
                  )}
                </View>
                {resolvingAccount && (
                  <Text style={[styles.hintText, { color: colors.textSecondary }]}>
                    Resolving account name...
                  </Text>
                )}
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, { 
                backgroundColor: colors.primary,
                opacity: (!formData.bankName || !formData.accountNumber || !formData.accountName || formData.accountNumber.length !== 10) ? 0.5 : 1
              }]}
              onPress={handleSaveBankDetails}
              disabled={!formData.bankName || !formData.accountNumber || !formData.accountName || formData.accountNumber.length !== 10}>
              <Text style={styles.buttonText}>Save Bank Details</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Request Payout Modal */}
      <Modal
        visible={payoutModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPayoutModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Request Payout</Text>
              <TouchableOpacity
                onPress={() => setPayoutModalVisible(false)}
                style={[styles.closeButton, { backgroundColor: colors.backgroundSecondary }]}>
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={[styles.label, { color: colors.text }]}>Amount (₦)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                placeholder="Enter amount"
                placeholderTextColor={colors.textSecondary}
                value={payoutAmount}
                onChangeText={setPayoutAmount}
                keyboardType="numeric"
              />

              {platformSettings?.minPayoutAmount && (
                <Text style={[styles.minPayoutText, { color: colors.textSecondary, marginBottom: 16 }]}>
                  Minimum: ₦{platformSettings.minPayoutAmount.toLocaleString()}
                </Text>
              )}

              <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.primary, opacity: requestingPayout ? 0.6 : 1 }]}
                onPress={handleRequestPayout}
                disabled={requestingPayout}>
                {requestingPayout ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Request Payout</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof import('@/lib/theme/colors').getColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingTop: 60,
      paddingBottom: 20,
      paddingHorizontal: 20,
      ...premiumShadow,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
    },
    content: {
      flex: 1,
      padding: 20,
    },
    section: {
      padding: 20,
      borderRadius: 16,
      marginBottom: 20,
      ...premiumShadow,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 8,
    },
    bankDetails: {
      marginBottom: 16,
    },
    bankDetailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    bankDetailLabel: {
      fontSize: 14,
    },
    bankDetailValue: {
      fontSize: 14,
      fontWeight: '600',
    },
    button: {
      padding: 16,
      borderRadius: 12,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    minPayoutText: {
      fontSize: 12,
      marginBottom: 12,
    },
    payoutItem: {
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    payoutHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 8,
    },
    payoutAmount: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 4,
    },
    payoutDate: {
      fontSize: 14,
    },
    payoutProcessed: {
      fontSize: 12,
      marginTop: 4,
    },
    payoutError: {
      fontSize: 12,
      marginTop: 4,
    },
    statusBadge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
    },
    statusText: {
      fontSize: 12,
      fontWeight: '600',
    },
    emptyText: {
      fontSize: 14,
      textAlign: 'center',
      padding: 20,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      maxHeight: '90%',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    modalTitle: {
      fontSize: 24,
      fontWeight: 'bold',
    },
    closeButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalBody: {
      padding: 20,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    inputGroup: {
      marginBottom: 20,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 16,
      height: 56,
    },
    input: {
      flex: 1,
      fontSize: 16,
      height: '100%',
    },
    hintText: {
      fontSize: 12,
      marginTop: 4,
    },
    bankSelectorButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderRadius: 12,
      padding: 16,
      height: 56,
    },
    bankSelectorText: {
      fontSize: 16,
    },
    bankSearchContainer: {
      marginTop: 12,
      borderRadius: 12,
      padding: 12,
      maxHeight: 300,
    },
    searchInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      height: 44,
      marginBottom: 12,
      gap: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
    },
    bankList: {
      maxHeight: 250,
    },
    bankItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderBottomWidth: 1,
    },
    bankItemContent: {
      flex: 1,
    },
    bankItemName: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    bankItemCode: {
      fontSize: 12,
    },
    selectedBankCard: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 16,
    },
    selectedBankContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    selectedBankName: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    selectedBankInfo: {
      fontSize: 12,
    },
  });
