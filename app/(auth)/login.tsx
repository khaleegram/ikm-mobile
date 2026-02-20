import { auth } from '@/lib/firebase/config';
import { router } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useState } from 'react';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function LoginScreen() {
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const lightBrown = '#A67C52';
  
  const handleLogin = async () => {
    if (!email || !password) {
      haptics.error();
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      haptics.success();
    } catch (error: any) {
      haptics.error();
      Alert.alert('Login Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  const styles = createStyles(colors, insets, lightBrown);

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.content}>
          
          {/* 1. EDITORIAL HEADER */}
          <View style={styles.header}>
            <View style={styles.logoCircle}>
               <IconSymbol name="storefront.fill" size={32} color="#FFFFFF" />
            </View>
            <Text style={styles.welcomeText}>Merchant{"\n"}Portal</Text>
            <View style={styles.accentBar} />
          </View>

          {/* 2. SOPHISTICATED FORM */}
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>EMAIL ADDRESS</Text>
              <TextInput
                style={styles.input}
                placeholder="name@store.com"
                placeholderTextColor={colors.textSecondary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>PASSWORD</Text>
              <View style={styles.passwordWrapper}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textSecondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <IconSymbol name={showPassword ? 'eye.slash' : 'eye'} size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={styles.forgotBtn}>
              <Text style={styles.forgotText}>Forgot Credentials?</Text>
            </TouchableOpacity>
          </View>

          {/* 3. ACTION SECTION */}
          <View style={styles.footer}>
            <TouchableOpacity 
              style={styles.mainButton} 
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.buttonText}>Sign In to Dashboard</Text>
                  <IconSymbol name="arrow.right" size={18} color="#fff" />
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.secondaryButton}
              onPress={() => router.push('/(auth)/signup')}
            >
              <Text style={styles.secondaryButtonText}>
                New here? <Text style={{ color: lightBrown, fontWeight: '800' }}>Create Merchant Account</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const createStyles = (colors: any, insets: any, themeBrown: string) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, paddingHorizontal: 32, paddingTop: insets.top + 60 },
  
  header: { marginBottom: 60 },
  logoCircle: { 
    width: 60, 
    height: 60, 
    borderRadius: 30, 
    backgroundColor: themeBrown, 
    justifyContent: 'center', 
    alignItems: 'center',
    marginBottom: 24
  },
  welcomeText: { 
    fontSize: 42, 
    fontWeight: '800', 
    color: colors.text, 
    lineHeight: 48,
    letterSpacing: -1
  },
  accentBar: { 
    width: 40, 
    height: 6, 
    backgroundColor: themeBrown, 
    marginTop: 16, 
    borderRadius: 3 
  },

  form: { gap: 32 },
  inputGroup: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 },
  label: { 
    fontSize: 10, 
    fontWeight: '800', 
    color: themeBrown, 
    letterSpacing: 1.5,
    marginBottom: 8 
  },
  input: { 
    fontSize: 18, 
    color: colors.text, 
    fontWeight: '600',
    paddingVertical: 8
  },
  passwordWrapper: { flexDirection: 'row', alignItems: 'center' },
  forgotBtn: { alignSelf: 'flex-start', marginTop: 8 },
  forgotText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },

  footer: { marginTop: 'auto', marginBottom: insets.bottom + 40 },
  mainButton: { 
    backgroundColor: themeBrown, 
    height: 64, 
    borderRadius: 20, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 12,
    shadowColor: themeBrown,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  secondaryButton: { marginTop: 24, alignItems: 'center' },
  secondaryButtonText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' }
});