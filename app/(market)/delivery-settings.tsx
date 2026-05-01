import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { NIGERIA_LOCATION_OPTIONS } from '@/lib/constants/nigeria-locations';
import { useUser } from '@/lib/firebase/auth/use-user';
import { firestore } from '@/lib/firebase/config';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { useTheme } from '@/lib/theme/theme-context';
import { getDeviceCoordinates } from '@/lib/utils/device-location';
import { haptics } from '@/lib/utils/haptics';
import { router } from 'expo-router';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const lightBrown = '#A67C52';
const NIGERIA_STATES = [...new Set(NIGERIA_LOCATION_OPTIONS.map((item) => item.state))].sort((a, b) =>
  a.localeCompare(b)
);

export default function MarketDeliverySettingsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { user: profile, loading } = useUserProfile(user?.uid || null);

  const [saving, setSaving] = useState(false);
  const [capturingLocation, setCapturingLocation] = useState(false);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [locationSearch, setLocationSearch] = useState('');

  const phone = String((profile as any)?.marketBuyerPhone || profile?.phone || '').trim();
  const savedLocation = useMemo(() => {
    const raw = (profile as any)?.marketBuyerLocation || {};
    return {
      state: String(raw.state || '').trim(),
      city: String(raw.city || '').trim(),
      address: String(raw.address || '').trim(),
      latitude: Number(raw.latitude || 0),
      longitude: Number(raw.longitude || 0),
    };
  }, [profile]);

  const [deliveryState, setDeliveryState] = useState(savedLocation.state);
  const [deliveryCity, setDeliveryCity] = useState(savedLocation.city);
  const [addressLine, setAddressLine] = useState(savedLocation.address);
  const [coordinates, setCoordinates] = useState<{
    latitude?: number;
    longitude?: number;
  }>({
    latitude: Number(savedLocation.latitude || 0) || undefined,
    longitude: Number(savedLocation.longitude || 0) || undefined,
  });

  React.useEffect(() => {
    setDeliveryState((prev) => prev || savedLocation.state);
    setDeliveryCity((prev) => prev || savedLocation.city);
    setAddressLine((prev) => prev || savedLocation.address);
  }, [savedLocation.address, savedLocation.city, savedLocation.state]);

  React.useEffect(() => {
    setCoordinates((prev) => ({
      latitude: prev.latitude ?? (Number(savedLocation.latitude || 0) || undefined),
      longitude: prev.longitude ?? (Number(savedLocation.longitude || 0) || undefined),
    }));
  }, [savedLocation.latitude, savedLocation.longitude]);

  const ALL_LOCATIONS = useMemo(() => {
    const list: Array<{ city: string; state: string; label: string }> = [];
    NIGERIA_LOCATION_OPTIONS.forEach(opt => {
      list.push({ city: opt.city, state: opt.state, label: `${opt.city}, ${opt.state}` });
    });
    const unique = new Map<string, typeof list[0]>();
    list.forEach(i => unique.set(i.label, i));
    return [...unique.values()].sort((a,b) => a.label.localeCompare(b.label));
  }, []);

  const filteredLocations = useMemo(() => {
    const queryValue = locationSearch.trim().toLowerCase();
    if (!queryValue) return ALL_LOCATIONS;
    return ALL_LOCATIONS.filter((loc) => loc.label.toLowerCase().includes(queryValue));
  }, [ALL_LOCATIONS, locationSearch]);

  const handleUseDeviceLocation = async () => {
    if (!user?.uid) return;
    try {
      setCapturingLocation(true);
      const coordinates = await getDeviceCoordinates();
      await setDoc(
        doc(firestore, 'users', user.uid),
        {
          marketBuyerLocation: {
            state: deliveryState,
            city: deliveryCity,
            address: addressLine.trim(),
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setCoordinates({
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      });
      haptics.success();
      showToast('Device coordinates saved.', 'success');
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Unable to capture location.', 'error');
    } finally {
      setCapturingLocation(false);
    }
  };

  const handleSave = async () => {
    if (!user?.uid) {
      router.replace('/(market)' as any);
      return;
    }
    if (!phone) {
      showToast('Verify your phone first.', 'error');
      router.push('/complete-phone' as any);
      return;
    }
    if (!deliveryState) {
      showToast('Select delivery state.', 'error');
      return;
    }
    if (!deliveryCity) {
      showToast('Select delivery city.', 'error');
      return;
    }
    if (addressLine.trim().length < 5) {
      showToast('Enter a valid delivery address.', 'error');
      return;
    }

    try {
      setSaving(true);
      await setDoc(
        doc(firestore, 'users', user.uid),
        {
          marketBuyerPhone: phone,
          marketBuyerLocation: {
            state: deliveryState,
            city: deliveryCity,
            address: addressLine.trim(),
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      haptics.success();
      showToast('Saved delivery settings updated.', 'success');
      router.back();
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Failed to save delivery settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!user || loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={lightBrown} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 10,
            borderBottomColor: colors.border,
          },
        ]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerIcon}>
          <IconSymbol name="arrow.left" size={21} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Saved Delivery Settings</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={[styles.content, { paddingBottom: insets.bottom + 20 }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text }]}>Phone Number</Text>
          <View
            style={[
              styles.readonlyField,
              {
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}>
            <Text style={[styles.readonlyValue, { color: phone ? colors.text : colors.textSecondary }]}>
              {phone || 'Not set'}
            </Text>
          </View>
          <Text style={[styles.helper, { color: colors.textSecondary }]}>
            Phone is locked here. Update it through phone verification.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text }]}>Delivery Location</Text>
          <TouchableOpacity
            style={[
              styles.locationPicker,
              {
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
            onPress={() => setLocationPickerVisible(true)}>
            <IconSymbol name="location.fill" size={16} color={lightBrown} />
            <Text
              style={[styles.locationPickerText, { color: deliveryCity ? colors.text : colors.textSecondary }]}>
              {deliveryCity && deliveryState ? `${deliveryCity}, ${deliveryState}` : 'Search city or area'}
            </Text>
            <IconSymbol name="chevron.right" size={14} color={colors.textSecondary} />
          </TouchableOpacity>

          <Text style={[styles.label, { color: colors.text, marginTop: 12 }]}>Delivery Address</Text>
          <TextInput
            value={addressLine}
            onChangeText={setAddressLine}
            placeholder="House, street, area, nearest landmark"
            placeholderTextColor={colors.textSecondary}
            multiline
            style={[
              styles.input,
              styles.multiline,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
          />

          <TouchableOpacity
            style={[styles.secondaryAction, { borderColor: colors.border }]}
            onPress={handleUseDeviceLocation}
            disabled={capturingLocation}>
            {capturingLocation ? (
              <ActivityIndicator size="small" color={lightBrown} />
            ) : (
              <>
                <IconSymbol name="location.fill" size={15} color={lightBrown} />
                <Text style={[styles.secondaryActionText, { color: colors.text }]}>Use Device Location</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.saveAction,
            {
              backgroundColor: saving ? `${lightBrown}AA` : lightBrown,
              opacity: saving ? 0.85 : 1,
            },
          ]}
          onPress={handleSave}
          disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.saveActionText}>Save Delivery Settings</Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal
        visible={locationPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLocationPickerVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setLocationPickerVisible(false)}>
          <Pressable
            style={[
              styles.modalSheet,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
                paddingBottom: insets.bottom + 12,
              },
            ]}
            onPress={(event) => event.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Select Location</Text>
              <TouchableOpacity onPress={() => setLocationPickerVisible(false)}>
                <IconSymbol name="xmark" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.searchWrap,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}>
              <IconSymbol name="magnifyingglass" size={15} color={colors.textSecondary} />
              <TextInput
                value={locationSearch}
                onChangeText={setLocationSearch}
                placeholder="Search your city or area..."
                placeholderTextColor={colors.textSecondary}
                style={[styles.searchInput, { color: colors.text }]}
                autoCapitalize="words"
              />
            </View>

            <FlatList
              data={filteredLocations}
              keyExtractor={(item) => item.label}
              keyboardShouldPersistTaps="always"
              contentContainerStyle={styles.modalListContent}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalRowItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    haptics.light();
                    setDeliveryState(item.state);
                    setDeliveryCity(item.city);
                    setLocationSearch('');
                    setLocationPickerVisible(false);
                  }}>
                  <Text style={[styles.modalRowText, { color: colors.text }]}>{item.label}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyCityWrap}>
                  <Text style={[styles.emptyCityText, { color: colors.textSecondary }]}>
                    No location matches this search.
                  </Text>
                </View>
              }
            />
          </Pressable>
        </Pressable>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  helper: {
    marginTop: 7,
    fontSize: 12,
    fontWeight: '600',
  },
  readonlyField: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  readonlyValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  locationPicker: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  locationPickerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: 'top',
    paddingTop: 10,
    height: undefined,
  },
  secondaryAction: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  saveAction: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 'auto',
  },
  saveActionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '72%',
    borderTopWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  searchWrap: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  modalListContent: {
    paddingBottom: 8,
  },
  modalRowItem: {
    minHeight: 46,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  modalRowText: {
    fontSize: 14,
    fontWeight: '700',
  },
  emptyCityWrap: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  emptyCityText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
