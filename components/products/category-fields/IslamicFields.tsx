// Islamic Products category fields
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface IslamicFieldsProps {
  formData: Record<string, any>;
  onChange: (field: string, value: any) => void;
  errors: Record<string, string>;
}

const ISLAMIC_TYPES = ['prayer-mat', 'tasbih', 'book', 'misbaha', 'hijab', 'prayer-cap', 'other'];
const ISLAMIC_SIZES = ['small', 'medium', 'large', 'standard'];
const ISLAMIC_MATERIALS = ['wool', 'cotton', 'plastic', 'wood', 'synthetic', 'other'];

export function IslamicFields({ formData, onChange, errors }: IslamicFieldsProps) {
  const { colors } = useTheme();
  const [showProductTypePicker, setShowProductTypePicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Islamic Products Details</Text>

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
              borderColor: errors.islamicType ? colors.error : colors.cardBorder,
            },
          ]}
          onPress={() => setShowProductTypePicker(true)}>
          <Text style={[styles.pickerText, { color: formData.islamicType ? colors.text : colors.textSecondary }]}>
            {formData.islamicType || 'Select product type'}
          </Text>
          <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        {errors.islamicType && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.islamicType}</Text>
        )}
      </View>

      {/* Size */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Size <Text style={styles.required}>*</Text>
        </Text>
        <TouchableOpacity
          style={[
            styles.pickerButton,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: errors.islamicSize ? colors.error : colors.cardBorder,
            },
          ]}
          onPress={() => setShowSizePicker(true)}>
          <Text style={[styles.pickerText, { color: formData.islamicSize ? colors.text : colors.textSecondary }]}>
            {formData.islamicSize || 'Select size'}
          </Text>
          <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        {errors.islamicSize && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.islamicSize}</Text>
        )}
      </View>

      {/* Material */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Material <Text style={styles.required}>*</Text>
        </Text>
        <TouchableOpacity
          style={[
            styles.pickerButton,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: errors.islamicMaterial ? colors.error : colors.cardBorder,
            },
          ]}
          onPress={() => setShowMaterialPicker(true)}>
          <Text style={[styles.pickerText, { color: formData.islamicMaterial ? colors.text : colors.textSecondary }]}>
            {formData.islamicMaterial || 'Select material'}
          </Text>
          <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        {errors.islamicMaterial && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.islamicMaterial}</Text>
        )}
      </View>

      {/* Modals */}
      <PickerModal
        visible={showProductTypePicker}
        title="Select Product Type"
        options={ISLAMIC_TYPES.map((t) => ({ label: t.replace('-', ' '), value: t }))}
        selectedValue={formData.islamicType}
        onSelect={(value) => {
          onChange('islamicType', value);
          setShowProductTypePicker(false);
        }}
        onClose={() => setShowProductTypePicker(false)}
        colors={colors}
      />

      <PickerModal
        visible={showSizePicker}
        title="Select Size"
        options={ISLAMIC_SIZES.map((s) => ({ label: s.charAt(0).toUpperCase() + s.slice(1), value: s }))}
        selectedValue={formData.islamicSize}
        onSelect={(value) => {
          onChange('islamicSize', value);
          setShowSizePicker(false);
        }}
        onClose={() => setShowSizePicker(false)}
        colors={colors}
      />

      <PickerModal
        visible={showMaterialPicker}
        title="Select Material"
        options={ISLAMIC_MATERIALS.map((m) => ({ label: m.charAt(0).toUpperCase() + m.slice(1), value: m }))}
        selectedValue={formData.islamicMaterial}
        onSelect={(value) => {
          onChange('islamicMaterial', value);
          setShowMaterialPicker(false);
        }}
        onClose={() => setShowMaterialPicker(false)}
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

