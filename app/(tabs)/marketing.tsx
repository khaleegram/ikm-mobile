// Marketing screen - Discount Codes & Email Campaigns
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow } from '@/lib/theme/styles';
import { useSellerDiscountCodes } from '@/lib/firebase/firestore/discount-codes';
import { useUser } from '@/lib/firebase/auth/use-user';
import { marketingApi } from '@/lib/api/marketing';
import { DiscountCode } from '@/types';
import { useSellerEmailCampaigns } from '@/lib/firebase/firestore/email-campaigns';
import { EmailCampaign } from '@/types';

export default function MarketingScreen() {
  const { colors } = useTheme();
  const { user } = useUser();
  const { discountCodes, loading } = useSellerDiscountCodes(user?.uid || null);
  const [activeTab, setActiveTab] = useState<'codes' | 'campaigns'>('codes');
  const [modalVisible, setModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({
    code: '',
    type: 'percentage' as 'percentage' | 'fixed',
    value: '',
    maxUses: '',
    minOrderAmount: '',
    validUntil: '',
  });
  const styles = createStyles(colors);

  const handleCreateCode = async () => {
    if (!user || !formData.code || !formData.value) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    const valueNum = parseFloat(formData.value);
    if (isNaN(valueNum) || valueNum <= 0) {
      Alert.alert('Error', 'Please enter a valid value');
      return;
    }

    if (formData.type === 'percentage' && valueNum > 100) {
      Alert.alert('Error', 'Percentage cannot exceed 100%');
      return;
    }

    setCreating(true);
    try {
      await marketingApi.createDiscountCode(user.uid, {
        code: formData.code.toUpperCase(),
        type: formData.type,
        value: valueNum,
        maxUses: formData.maxUses ? parseInt(formData.maxUses) : undefined,
        minOrderAmount: formData.minOrderAmount ? parseFloat(formData.minOrderAmount) : undefined,
        validUntil: formData.validUntil ? new Date(formData.validUntil) : undefined,
      });
      Alert.alert('Success', 'Discount code created successfully');
      setModalVisible(false);
      setFormData({
        code: '',
        type: 'percentage',
        value: '',
        maxUses: '',
        minOrderAmount: '',
        validUntil: '',
      });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create discount code');
    } finally {
      setCreating(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return colors.success;
      case 'inactive':
        return colors.textSecondary;
      case 'expired':
        return colors.error;
      default:
        return colors.textSecondary;
    }
  };

  const formatDiscountValue = (code: DiscountCode) => {
    if (code.type === 'percentage') {
      return `${code.value}%`;
    }
    return `₦${code.value.toLocaleString()}`;
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <Text style={[styles.title, { color: colors.text }]}>Marketing</Text>

        {/* Tabs */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'codes' && { backgroundColor: colors.primary }]}
            onPress={() => setActiveTab('codes')}>
            <Text style={[styles.tabText, { color: activeTab === 'codes' ? '#fff' : colors.text }]}>
              Discount Codes
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'campaigns' && { backgroundColor: colors.primary }]}
            onPress={() => setActiveTab('campaigns')}>
            <Text style={[styles.tabText, { color: activeTab === 'campaigns' ? '#fff' : colors.text }]}>
              Email Campaigns
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {activeTab === 'codes' && (
        <View style={styles.content}>
          <TouchableOpacity
            style={[styles.createButton, { backgroundColor: colors.primary }]}
            onPress={() => setModalVisible(true)}>
            <IconSymbol name="plus.circle.fill" size={24} color="#fff" />
            <Text style={styles.createButtonText}>Create Discount Code</Text>
          </TouchableOpacity>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : discountCodes.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No discount codes yet. Create your first one!
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {discountCodes.map((code) => (
                <View key={code.id} style={[styles.codeCard, { backgroundColor: colors.card }]}>
                  <View style={styles.codeHeader}>
                    <View>
                      <Text style={[styles.codeName, { color: colors.text }]}>{code.code}</Text>
                      <Text style={[styles.codeValue, { color: colors.primary }]}>
                        {formatDiscountValue(code)}
                      </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: `${getStatusColor(code.status)}20` }]}>
                      <Text style={[styles.statusText, { color: getStatusColor(code.status) }]}>
                        {code.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.codeStats}>
                    <Text style={[styles.codeStat, { color: colors.textSecondary }]}>
                      Uses: {code.uses}{code.maxUses ? ` / ${code.maxUses}` : ''}
                    </Text>
                    {code.minOrderAmount && (
                      <Text style={[styles.codeStat, { color: colors.textSecondary }]}>
                        Min: ₦{code.minOrderAmount.toLocaleString()}
                      </Text>
                    )}
                  </View>
                  {code.validUntil && (
                    <Text style={[styles.codeDate, { color: colors.textSecondary }]}>
                      Expires: {new Date(code.validUntil).toLocaleDateString()}
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {activeTab === 'campaigns' && (
        <View style={styles.content}>
          <View style={styles.emptyContainer}>
            <IconSymbol name="megaphone.fill" size={64} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Email campaigns feature coming soon!
            </Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary, fontSize: 14, marginTop: 8 }]}>
              Send targeted email campaigns to your customers
            </Text>
          </View>
        </View>
      )}

      {/* Create Discount Code Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView
            style={[styles.modalContent, { backgroundColor: colors.card }]}
            contentContainerStyle={styles.modalBody}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Create Discount Code</Text>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                style={[styles.closeButton, { backgroundColor: colors.backgroundSecondary }]}>
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
              placeholder="Code (e.g., SAVE20)"
              placeholderTextColor={colors.textSecondary}
              value={formData.code}
              onChangeText={(text) => setFormData({ ...formData, code: text.toUpperCase() })}
              autoCapitalize="characters"
            />

            <View style={styles.typeSelector}>
              <TouchableOpacity
                style={[styles.typeButton, formData.type === 'percentage' && { backgroundColor: colors.primary }]}
                onPress={() => setFormData({ ...formData, type: 'percentage' })}>
                <Text style={[styles.typeButtonText, { color: formData.type === 'percentage' ? '#fff' : colors.text }]}>
                  Percentage
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeButton, formData.type === 'fixed' && { backgroundColor: colors.primary }]}
                onPress={() => setFormData({ ...formData, type: 'fixed' })}>
                <Text style={[styles.typeButtonText, { color: formData.type === 'fixed' ? '#fff' : colors.text }]}>
                  Fixed Amount
                </Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
              placeholder={formData.type === 'percentage' ? 'Percentage (0-100)' : 'Amount (₦)'}
              placeholderTextColor={colors.textSecondary}
              value={formData.value}
              onChangeText={(text) => setFormData({ ...formData, value: text })}
              keyboardType="numeric"
            />

            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
              placeholder="Max Uses (optional)"
              placeholderTextColor={colors.textSecondary}
              value={formData.maxUses}
              onChangeText={(text) => setFormData({ ...formData, maxUses: text })}
              keyboardType="numeric"
            />

            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
              placeholder="Min Order Amount (optional)"
              placeholderTextColor={colors.textSecondary}
              value={formData.minOrderAmount}
              onChangeText={(text) => setFormData({ ...formData, minOrderAmount: text })}
              keyboardType="numeric"
            />

            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.primary, opacity: creating ? 0.6 : 1 }]}
              onPress={handleCreateCode}
              disabled={creating}>
              {creating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Create Code</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
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
      marginBottom: 16,
    },
    tabContainer: {
      flexDirection: 'row',
      gap: 8,
    },
    tab: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: 'center',
    },
    tabText: {
      fontSize: 14,
      fontWeight: '600',
    },
    content: {
      flex: 1,
      padding: 20,
    },
    createButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      borderRadius: 12,
      marginBottom: 20,
      gap: 8,
    },
    createButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyContainer: {
      padding: 40,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 16,
      textAlign: 'center',
    },
    codeCard: {
      padding: 16,
      borderRadius: 16,
      marginBottom: 12,
      ...premiumShadow,
    },
    codeHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 12,
    },
    codeName: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 4,
    },
    codeValue: {
      fontSize: 18,
      fontWeight: '600',
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
    codeStats: {
      flexDirection: 'row',
      gap: 16,
      marginBottom: 8,
    },
    codeStat: {
      fontSize: 14,
    },
    codeDate: {
      fontSize: 12,
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
    input: {
      padding: 16,
      borderRadius: 12,
      fontSize: 16,
      marginBottom: 16,
      borderWidth: 1,
    },
    typeSelector: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 16,
    },
    typeButton: {
      flex: 1,
      padding: 12,
      borderRadius: 8,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    typeButtonText: {
      fontSize: 14,
      fontWeight: '600',
    },
    saveButton: {
      padding: 18,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 8,
    },
    saveButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
      color: colors.text,
    },
  });

