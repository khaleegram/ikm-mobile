// Skincare & Cosmetics category fields
import { View, Text, TextInput, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface SkincareFieldsProps {
  formData: Record<string, any>;
  onChange: (field: string, value: any) => void;
  errors: Record<string, string>;
}

const SKINCARE_TYPES = ['face-cream', 'soap', 'toner', 'serum', 'sunscreen', 'face-mask', 'exfoliant', 'other'];
const SKINCARE_SIZES = ['small', 'medium', 'large'];

export function SkincareFields({ formData, onChange, errors }: SkincareFieldsProps) {
  const { colors } = useTheme();
  const [showProductTypePicker, setShowProductTypePicker] = useState(false);
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Skincare & Cosmetics Details</Text>

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
              borderColor: errors.skincareBrand ? colors.error : colors.cardBorder,
              color: colors.text,
            },
          ]}
          placeholder="Enter brand name"
          placeholderTextColor={colors.textSecondary}
          value={formData.skincareBrand || ''}
          onChangeText={(value) => onChange('skincareBrand', value)}
        />
        {errors.skincareBrand && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.skincareBrand}</Text>
        )}
      </View>

      {/* Product Type */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Product Type <Text style={styles.required}>*</Text>
        </Text>
        <TouchableOpacity
          style={[
            styles.pickerButton,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: errors.skincareType ? colors.error : colors.cardBorder,
            },
          ]}
          onPress={() => setShowProductTypePicker(true)}>
          <Text style={[styles.pickerText, { color: formData.skincareType ? colors.text : colors.textSecondary }]}>
            {formData.skincareType || 'Select product type'}
          </Text>
          <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        {errors.skincareType && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.skincareType}</Text>
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
              borderColor: errors.skincareSize ? colors.error : colors.cardBorder,
              color: colors.text,
            },
          ]}
          placeholder="e.g., small, medium, large, or specific ml/g"
          placeholderTextColor={colors.textSecondary}
          value={formData.skincareSize || ''}
          onChangeText={(value) => onChange('skincareSize', value)}
        />
        {errors.skincareSize && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.skincareSize}</Text>
        )}
      </View>

      {/* Modals */}
      <PickerModal
        visible={showProductTypePicker}
        title="Select Product Type"
        options={SKINCARE_TYPES.map((t) => ({ label: t.replace('-', ' '), value: t }))}
        selectedValue={formData.skincareType}
        onSelect={(value) => {
          onChange('skincareType', value);
          setShowProductTypePicker(false);
        }}
        onClose={() => setShowProductTypePicker(false)}
        colors={colors}
      />
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
  });
}

