// Materials category fields
import { View, Text, TextInput, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface MaterialsFieldsProps {
  formData: Record<string, any>;
  onChange: (field: string, value: any) => void;
  errors: Record<string, string>;
}

const MATERIAL_TYPES = ['shadda', 'atiku', 'cotton', 'silk', 'linen', 'custom'];

export function MaterialsFields({ formData, onChange, errors }: MaterialsFieldsProps) {
  const { colors } = useTheme();
  const [showMaterialTypePicker, setShowMaterialTypePicker] = useState(false);
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Materials Details</Text>

      {/* Material Type */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Material Type <Text style={styles.required}>*</Text>
        </Text>
        <TouchableOpacity
          style={[
            styles.pickerButton,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: errors.materialType ? colors.error : colors.cardBorder,
            },
          ]}
          onPress={() => setShowMaterialTypePicker(true)}>
          <Text style={[styles.pickerText, { color: formData.materialType ? colors.text : colors.textSecondary }]}>
            {formData.materialType || 'Select material type'}
          </Text>
          <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        {errors.materialType && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.materialType}</Text>
        )}
      </View>

      {/* Custom Material Type (if Material Type === "custom") */}
      {formData.materialType === 'custom' && (
        <View style={styles.fieldContainer}>
          <Text style={[styles.label, { color: colors.text }]}>
            Custom Material Type <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: errors.customMaterialType ? colors.error : colors.cardBorder,
                color: colors.text,
              },
            ]}
            placeholder="Enter custom material type"
            placeholderTextColor={colors.textSecondary}
            value={formData.customMaterialType || ''}
            onChangeText={(value) => onChange('customMaterialType', value)}
          />
          {errors.customMaterialType && (
            <Text style={[styles.errorText, { color: colors.error }]}>{errors.customMaterialType}</Text>
          )}
        </View>
      )}

      {/* Fabric Length */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Fabric Length <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: errors.fabricLength ? colors.error : colors.cardBorder,
              color: colors.text,
            },
          ]}
          placeholder="e.g., 6 yards"
          placeholderTextColor={colors.textSecondary}
          value={formData.fabricLength || ''}
          onChangeText={(value) => onChange('fabricLength', value)}
        />
        {errors.fabricLength && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.fabricLength}</Text>
        )}
      </View>

      {/* Quality (Optional) */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>Quality (Optional)</Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: colors.cardBorder,
              color: colors.text,
            },
          ]}
          placeholder="Quality description"
          placeholderTextColor={colors.textSecondary}
          value={formData.quality || ''}
          onChangeText={(value) => onChange('quality', value)}
        />
      </View>

      {/* Material Type Picker Modal */}
      <PickerModal
        visible={showMaterialTypePicker}
        title="Select Material Type"
        options={MATERIAL_TYPES.map((t) => ({ label: t.charAt(0).toUpperCase() + t.slice(1), value: t }))}
        selectedValue={formData.materialType}
        onSelect={(value) => {
          onChange('materialType', value.toLowerCase());
          if (value.toLowerCase() !== 'custom') {
            onChange('customMaterialType', '');
          }
          setShowMaterialTypePicker(false);
        }}
        onClose={() => setShowMaterialTypePicker(false)}
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

