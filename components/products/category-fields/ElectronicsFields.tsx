// Electronics category fields
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';

interface ElectronicsFieldsProps {
  formData: Record<string, any>;
  onChange: (field: string, value: any) => void;
  errors: Record<string, string>;
}

export function ElectronicsFields({ formData, onChange, errors }: ElectronicsFieldsProps) {
  const { colors } = useTheme();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Electronics Details</Text>

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
              borderColor: errors.brand ? colors.error : colors.cardBorder,
              color: colors.text,
            },
          ]}
          placeholder="Enter brand name"
          placeholderTextColor={colors.textSecondary}
          value={formData.brand || ''}
          onChangeText={(value) => onChange('brand', value)}
        />
        {errors.brand && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.brand}</Text>
        )}
      </View>

      {/* Model */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Model <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: errors.model ? colors.error : colors.cardBorder,
              color: colors.text,
            },
          ]}
          placeholder="Enter model name/number"
          placeholderTextColor={colors.textSecondary}
          value={formData.model || ''}
          onChangeText={(value) => onChange('model', value)}
        />
        {errors.model && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.model}</Text>
        )}
      </View>
    </View>
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
    errorText: {
      fontSize: 12,
      marginTop: 4,
    },
  });
}

