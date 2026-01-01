// Snacks category fields
import { View, Text, TextInput, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface SnacksFieldsProps {
  formData: Record<string, any>;
  onChange: (field: string, value: any) => void;
  errors: Record<string, string>;
  readOnly?: boolean;
}

const PACKAGING_OPTIONS = ['single-piece', 'pack-sachet', 'plastic-jar', 'bucket'];
const TASTE_OPTIONS = ['sweet', 'spicy', 'crunchy', 'soft'];

export function SnacksFields({ formData, onChange, errors, readOnly = false }: SnacksFieldsProps) {
  const { colors } = useTheme();
  const [showPackagingPicker, setShowPackagingPicker] = useState(false);
  const [showTastePicker, setShowTastePicker] = useState(false);
  const styles = createStyles(colors);

  // Format display values
  const formatPackaging = (value?: string) => {
    if (!value) return 'Not set';
    return value.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const formatTaste = (value?: string) => {
    if (!value) return 'Not set';
    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Snacks Details</Text>

      {/* Packaging */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Packaging {!readOnly && <Text style={styles.required}>*</Text>}
        </Text>
        {readOnly ? (
          <Text style={[styles.readOnlyValue, { color: colors.text }]}>
            {formatPackaging(formData.packaging)}
          </Text>
        ) : (
          <>
            <TouchableOpacity
              style={[
                styles.pickerButton,
                {
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: errors.packaging ? colors.error : colors.cardBorder,
                },
              ]}
              onPress={() => setShowPackagingPicker(true)}>
              <Text style={[styles.pickerText, { color: formData.packaging ? colors.text : colors.textSecondary }]}>
                {formData.packaging ? formatPackaging(formData.packaging) : 'Select packaging'}
              </Text>
              <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            {errors.packaging && (
              <Text style={[styles.errorText, { color: colors.error }]}>{errors.packaging}</Text>
            )}
          </>
        )}
      </View>

      {/* Quantity */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Quantity {!readOnly && <Text style={styles.required}>*</Text>}
        </Text>
        {readOnly ? (
          <Text style={[styles.readOnlyValue, { color: colors.text }]}>
            {formData.quantity ? `${formData.quantity} items` : 'Not set'}
          </Text>
        ) : (
          <>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: errors.quantity ? colors.error : colors.cardBorder,
                  color: colors.text,
                },
              ]}
              placeholder="Number of items"
              placeholderTextColor={colors.textSecondary}
              value={formData.quantity?.toString() || ''}
              onChangeText={(value) => onChange('quantity', value ? parseInt(value, 10) : undefined)}
              keyboardType="number-pad"
            />
            {errors.quantity && (
              <Text style={[styles.errorText, { color: colors.error }]}>{errors.quantity}</Text>
            )}
          </>
        )}
      </View>

      {/* Taste */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Taste {!readOnly && <Text style={styles.required}>*</Text>}
        </Text>
        {readOnly ? (
          <Text style={[styles.readOnlyValue, { color: colors.text }]}>
            {formatTaste(formData.taste)}
          </Text>
        ) : (
          <>
            <TouchableOpacity
              style={[
                styles.pickerButton,
                {
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: errors.taste ? colors.error : colors.cardBorder,
                },
              ]}
              onPress={() => setShowTastePicker(true)}>
              <Text style={[styles.pickerText, { color: formData.taste ? colors.text : colors.textSecondary }]}>
                {formData.taste ? formatTaste(formData.taste) : 'Select taste'}
              </Text>
              <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            {errors.taste && (
              <Text style={[styles.errorText, { color: colors.error }]}>{errors.taste}</Text>
            )}
          </>
        )}
      </View>

      {/* Modals - Only show if not read-only */}
      {!readOnly && (
        <>
          <PickerModal
            visible={showPackagingPicker}
            title="Select Packaging"
            options={PACKAGING_OPTIONS.map((t) => ({ label: t.replace('-', ' '), value: t }))}
            selectedValue={formData.packaging}
            onSelect={(value) => {
              onChange('packaging', value);
              setShowPackagingPicker(false);
            }}
            onClose={() => setShowPackagingPicker(false)}
            colors={colors}
          />

          <PickerModal
            visible={showTastePicker}
            title="Select Taste"
            options={TASTE_OPTIONS.map((t) => ({ label: t.charAt(0).toUpperCase() + t.slice(1), value: t }))}
            selectedValue={formData.taste}
            onSelect={(value) => {
              onChange('taste', value);
              setShowTastePicker(false);
            }}
            onClose={() => setShowTastePicker(false)}
            colors={colors}
          />
        </>
      )}
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
    },
    modalOptionText: {
      fontSize: 16,
    },
    readOnlyValue: {
      fontSize: 16,
      paddingVertical: 12,
      paddingHorizontal: 4,
    },
  });
}

