// Hair Care Products category fields
import { View, Text, TextInput, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface HairCareFieldsProps {
  formData: Record<string, any>;
  onChange: (field: string, value: any) => void;
  errors: Record<string, string>;
}

const HAIR_CARE_TYPES = ['hair-oil', 'treatment', 'shampoo', 'conditioner', 'package-deal'];
const PACKAGE_ITEMS = ['oil', 'shampoo', 'conditioner', 'treatment', 'mask'];

export function HairCareFields({ formData, onChange, errors }: HairCareFieldsProps) {
  const { colors } = useTheme();
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [showPackageItemsPicker, setShowPackageItemsPicker] = useState(false);
  const styles = createStyles(colors);

  const togglePackageItem = (item: string) => {
    const current = formData.haircarePackageItems || [];
    const updated = current.includes(item)
      ? current.filter((i: string) => i !== item)
      : [...current, item];
    onChange('haircarePackageItems', updated);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Hair Care Details</Text>

      {/* Type */}
      <View style={styles.fieldContainer}>
          <Text style={[styles.label, { color: colors.text }]}>
            Type <Text style={styles.required}>*</Text>
          </Text>
        <TouchableOpacity
          style={[
            styles.pickerButton,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: errors.haircareType ? colors.error : colors.cardBorder,
            },
          ]}
          onPress={() => setShowTypePicker(true)}>
          <Text style={[styles.pickerText, { color: formData.haircareType ? colors.text : colors.textSecondary }]}>
            {formData.haircareType || 'Select type'}
          </Text>
          <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        {errors.haircareType && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.haircareType}</Text>
        )}
      </View>

      {/* Brand */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Brand <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: errors.haircareBrand ? colors.error : colors.cardBorder,
              color: colors.text,
            },
          ]}
          placeholder="Enter brand name"
          placeholderTextColor={colors.textSecondary}
          value={formData.haircareBrand || ''}
          onChangeText={(value) => onChange('haircareBrand', value)}
        />
        {errors.haircareBrand && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.haircareBrand}</Text>
        )}
      </View>

      {/* Size */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Size <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: errors.haircareSize ? colors.error : colors.cardBorder,
              color: colors.text,
            },
          ]}
          placeholder="e.g., small, medium, large, or specific size"
          placeholderTextColor={colors.textSecondary}
          value={formData.haircareSize || ''}
          onChangeText={(value) => onChange('haircareSize', value)}
        />
        {errors.haircareSize && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.haircareSize}</Text>
        )}
      </View>

      {/* Package Items (if Type === "package-deal") */}
      {formData.haircareType === 'package-deal' && (
        <View style={styles.fieldContainer}>
          <Text style={[styles.label, { color: colors.text }]}>
            Package Items <Text style={styles.required}>*</Text>
          </Text>
          <TouchableOpacity
            style={[
              styles.pickerButton,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: errors.haircarePackageItems ? colors.error : colors.cardBorder,
              },
            ]}
            onPress={() => setShowPackageItemsPicker(true)}>
            <Text style={[styles.pickerText, { color: colors.text }]}>
              {formData.haircarePackageItems && formData.haircarePackageItems.length > 0
                ? `${formData.haircarePackageItems.length} item(s) selected`
                : 'Select package items'}
            </Text>
            <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          {errors.haircarePackageItems && (
            <Text style={[styles.errorText, { color: colors.error }]}>{errors.haircarePackageItems}</Text>
          )}
        </View>
      )}

      {/* Modals */}
      <PickerModal
        visible={showTypePicker}
        title="Select Type"
        options={HAIR_CARE_TYPES.map((t) => ({ label: t.replace('-', ' '), value: t }))}
        selectedValue={formData.haircareType}
        onSelect={(value) => {
          onChange('haircareType', value);
          if (value !== 'package-deal') {
            onChange('haircarePackageItems', []);
          }
          setShowTypePicker(false);
        }}
        onClose={() => setShowTypePicker(false)}
        colors={colors}
      />

      {/* Package Items Multi-Select Modal */}
      <Modal
        visible={showPackageItemsPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPackageItemsPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Select Package Items</Text>
              <TouchableOpacity onPress={() => setShowPackageItemsPicker(false)}>
                <IconSymbol name="xmark" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {PACKAGE_ITEMS.map((item) => {
                const isSelected = formData.haircarePackageItems?.includes(item);
                return (
                  <TouchableOpacity
                    key={item}
                    style={[
                      styles.modalOption,
                      {
                        backgroundColor: isSelected ? colors.primary : colors.backgroundSecondary,
                      },
                    ]}
                    onPress={() => togglePackageItem(item)}>
                    <Text
                      style={[
                        styles.modalOptionText,
                        { color: isSelected ? '#FFFFFF' : colors.text },
                      ]}>
                      {item}
                    </Text>
                    {isSelected && <IconSymbol name="checkmark" size={20} color="#FFFFFF" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Reusable Picker Modal Component
function PickerModal({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
  colors,
}: {
  visible: boolean;
  title: string;
  options: Array<{ label: string; value: string }>;
  selectedValue?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  colors: any;
}) {
  const styles = createStyles(colors);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <IconSymbol name="xmark" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView>
            {options.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.modalOption,
                  {
                    backgroundColor: selectedValue === option.value ? colors.primary : colors.backgroundSecondary,
                  },
                ]}
                onPress={() => {
                  onSelect(option.value);
                }}
                activeOpacity={0.7}>
                <Text
                  style={[
                    styles.modalOptionText,
                    { color: selectedValue === option.value ? '#FFFFFF' : colors.text },
                  ]}>
                  {option.label}
                </Text>
                {selectedValue === option.value && (
                  <IconSymbol name="checkmark" size={20} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(colors: any) {
  return StyleSheet.create({
    container: {
      marginTop: 16,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 16,
    },
    fieldContainer: {
      marginBottom: 16,
    },
    label: {
      fontSize: 14,
      fontWeight: '500',
      marginBottom: 8,
    },
    required: {
      color: '#DC3545',
    },
    input: {
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      fontSize: 16,
    },
    pickerButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
    },
    pickerText: {
      fontSize: 16,
    },
    errorText: {
      fontSize: 12,
      marginTop: 4,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      maxHeight: '70%',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '600',
    },
    modalOption: {
      padding: 16,
      borderRadius: 8,
      marginBottom: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    modalOptionText: {
      fontSize: 16,
    },
  });
}

