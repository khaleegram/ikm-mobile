// Shipping zones management screen
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow } from '@/lib/theme/styles';
import { useSellerShippingZones } from '@/lib/firebase/firestore/shipping';
import { useUser } from '@/lib/firebase/auth/use-user';
import { shippingApi } from '@/lib/api/shipping';
import { ShippingZone } from '@/types';

export default function ShippingScreen() {
  const { colors } = useTheme();
  const { user } = useUser();
  const { zones, loading } = useSellerShippingZones(user?.uid || null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingZone, setEditingZone] = useState<ShippingZone | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    rate: '',
    freeThreshold: '',
    states: '',
  });
  const styles = createStyles(colors);

  const handleOpenModal = (zone?: ShippingZone) => {
    if (zone) {
      setEditingZone(zone);
      setFormData({
        name: zone.name,
        rate: zone.rate.toString(),
        freeThreshold: zone.freeThreshold?.toString() || '',
        states: zone.states?.join(', ') || '',
      });
    } else {
      setEditingZone(null);
      setFormData({
        name: '',
        rate: '',
        freeThreshold: '',
        states: '',
      });
    }
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!user || !formData.name || !formData.rate) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    const rate = parseFloat(formData.rate);
    if (isNaN(rate) || rate < 0) {
      Alert.alert('Error', 'Please enter a valid shipping rate');
      return;
    }

    const freeThreshold = formData.freeThreshold ? parseFloat(formData.freeThreshold) : undefined;
    if (freeThreshold !== undefined && (isNaN(freeThreshold) || freeThreshold < 0)) {
      Alert.alert('Error', 'Free shipping threshold must be a valid number');
      return;
    }

    const states = formData.states
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      if (editingZone?.id) {
        await shippingApi.updateShippingZone(user.uid, editingZone.id, {
          name: formData.name,
          rate,
          freeThreshold,
          states: states.length > 0 ? states : undefined,
        });
        Alert.alert('Success', 'Shipping zone updated successfully');
      } else {
        await shippingApi.createShippingZone(user.uid, {
          name: formData.name,
          rate,
          freeThreshold,
          states: states.length > 0 ? states : undefined,
        });
        Alert.alert('Success', 'Shipping zone created successfully');
      }
      setModalVisible(false);
      setEditingZone(null);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save shipping zone');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (zoneId: string) => {
    Alert.alert(
      'Delete Shipping Zone',
      'Are you sure you want to delete this shipping zone?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!user) return;
            try {
              await shippingApi.deleteShippingZone(user.uid, zoneId);
              Alert.alert('Success', 'Shipping zone deleted successfully');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete shipping zone');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <Text style={[styles.title, { color: colors.text }]}>Shipping Zones</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Configure shipping rates by location
        </Text>
      </View>

      <View style={styles.content}>
        <TouchableOpacity
          style={[styles.createButton, { backgroundColor: colors.primary }]}
          onPress={() => handleOpenModal()}>
          <IconSymbol name="plus.circle.fill" size={24} color="#fff" />
          <Text style={styles.createButtonText}>Create Shipping Zone</Text>
        </TouchableOpacity>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : zones.length === 0 ? (
          <View style={styles.emptyContainer}>
            <IconSymbol name="shippingbox.fill" size={64} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No shipping zones yet. Create your first one!
            </Text>
            <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
              Define shipping rates for different states or regions
            </Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {zones.map((zone) => (
              <View key={zone.id} style={[styles.zoneCard, { backgroundColor: colors.card }]}>
                <View style={styles.zoneHeader}>
                  <View style={styles.zoneIcon}>
                    <IconSymbol name="shippingbox.fill" size={24} color={colors.primary} />
                  </View>
                  <View style={styles.zoneInfo}>
                    <Text style={[styles.zoneName, { color: colors.text }]}>{zone.name}</Text>
                    <Text style={[styles.zoneRate, { color: colors.primary }]}>
                      ₦{zone.rate.toLocaleString()}
                    </Text>
                  </View>
                  <View style={styles.zoneActions}>
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: colors.backgroundSecondary }]}
                      onPress={() => handleOpenModal(zone)}>
                      <IconSymbol name="pencil.fill" size={18} color={colors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: colors.error + '20' }]}
                      onPress={() => zone.id && handleDelete(zone.id)}>
                      <IconSymbol name="trash.fill" size={18} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>

                {zone.freeThreshold && (
                  <View style={styles.zoneDetail}>
                    <IconSymbol name="tag.fill" size={16} color={colors.success} />
                    <Text style={[styles.zoneDetailText, { color: colors.textSecondary }]}>
                      Free shipping on orders over ₦{zone.freeThreshold.toLocaleString()}
                    </Text>
                  </View>
                )}

                {zone.states && zone.states.length > 0 && (
                  <View style={styles.zoneDetail}>
                    <IconSymbol name="location.fill" size={16} color={colors.info} />
                    <Text style={[styles.zoneDetailText, { color: colors.textSecondary }]}>
                      {zone.states.join(', ')}
                    </Text>
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Create/Edit Zone Modal */}
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
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {editingZone ? 'Edit Shipping Zone' : 'Create Shipping Zone'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setModalVisible(false);
                  setEditingZone(null);
                }}
                style={[styles.closeButton, { backgroundColor: colors.backgroundSecondary }]}>
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.label, { color: colors.text }]}>Zone Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
              placeholder="e.g., Lagos & Abuja Zone"
              placeholderTextColor={colors.textSecondary}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
            />

            <Text style={[styles.label, { color: colors.text }]}>Shipping Rate (₦)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
              placeholder="e.g., 1500"
              placeholderTextColor={colors.textSecondary}
              value={formData.rate}
              onChangeText={(text) => setFormData({ ...formData, rate: text })}
              keyboardType="numeric"
            />

            <Text style={[styles.label, { color: colors.text }]}>Free Shipping Threshold (₦) - Optional</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
              placeholder="e.g., 5000 (free shipping if order >= this amount)"
              placeholderTextColor={colors.textSecondary}
              value={formData.freeThreshold}
              onChangeText={(text) => setFormData({ ...formData, freeThreshold: text })}
              keyboardType="numeric"
            />

            <Text style={[styles.label, { color: colors.text }]}>States - Optional</Text>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Enter state names separated by commas (e.g., Lagos, Abuja, Port Harcourt)
            </Text>
            <TextInput
              style={[styles.input, styles.textArea, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
              placeholder="Lagos, Abuja, Port Harcourt"
              placeholderTextColor={colors.textSecondary}
              value={formData.states}
              onChangeText={(text) => setFormData({ ...formData, states: text })}
              multiline
              numberOfLines={3}
            />

            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
              onPress={handleSave}
              disabled={saving}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>
                  {editingZone ? 'Update Zone' : 'Create Zone'}
                </Text>
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
      paddingBottom: 24,
      paddingHorizontal: 20,
      ...premiumShadow,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 14,
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
      alignItems: 'center',
      padding: 40,
    },
    emptyText: {
      fontSize: 16,
      fontWeight: '600',
      marginTop: 16,
      marginBottom: 8,
      textAlign: 'center',
    },
    emptySubtext: {
      fontSize: 14,
      textAlign: 'center',
    },
    zoneCard: {
      padding: 16,
      borderRadius: 16,
      marginBottom: 12,
      ...premiumShadow,
    },
    zoneHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    zoneIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primary + '20',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    zoneInfo: {
      flex: 1,
    },
    zoneName: {
      fontSize: 18,
      fontWeight: 'bold',
      marginBottom: 4,
    },
    zoneRate: {
      fontSize: 16,
      fontWeight: '600',
    },
    zoneActions: {
      flexDirection: 'row',
      gap: 8,
    },
    actionButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    zoneDetail: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
      gap: 8,
    },
    zoneDetailText: {
      fontSize: 14,
      flex: 1,
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
      marginTop: 16,
    },
    hint: {
      fontSize: 12,
      marginBottom: 8,
    },
    input: {
      padding: 16,
      borderRadius: 12,
      fontSize: 16,
      borderWidth: 1,
    },
    textArea: {
      minHeight: 80,
      textAlignVertical: 'top',
    },
    saveButton: {
      padding: 18,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 24,
    },
    saveButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
  });

