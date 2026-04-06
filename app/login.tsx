import { useState } from 'react';
import { StyleSheet, View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, useColorScheme, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string, type: 'error' | 'success'} | null>(null);
  
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();

  async function signInWithEmail() {
    setLoading(true);
    setStatusMsg(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });
    if (error) setStatusMsg({ text: error.message, type: 'error' });
    else router.replace('/');
    setLoading(false);
  }

  async function signUpWithEmail() {
    setLoading(true);
    setStatusMsg(null);
    const { error } = await supabase.auth.signUp({
      email: email,
      password: password,
    });
    if (error) setStatusMsg({ text: error.message, type: 'error' });
    else setStatusMsg({ text: 'Success! Check your email to confirm your account (if enabled).', type: 'success' });
    setLoading(false);
  }

  async function signInWithApple() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (credential.identityToken) {
        setLoading(true);
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        });
        if (error) setStatusMsg({ text: error.message, type: 'error' });
        else router.replace('/');
      }
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') setStatusMsg({ text: e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    setLoading(true);
    setStatusMsg(null);
    try {
      // Hardcode the deep link schema for bare native iOS, bypassing Expo's dev server override
      const redirectUri = Platform.OS === 'web'
        ? window.location.origin + '/login'
        : 'ideamakers://auth/callback';
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: Platform.OS !== 'web',
        },
      });
      if (error) {
        setStatusMsg({ text: error.message, type: 'error' });
      } else if (data?.url && Platform.OS !== 'web') {
        const res = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
        if (res.type === 'success' && res.url) {
          // Parse returned access_token from the URL hash for Native
          const hashIdx = res.url.indexOf('#');
          if (hashIdx !== -1) {
            const hashParams = new URLSearchParams(res.url.substring(hashIdx + 1));
            const access_token = hashParams.get('access_token');
            const refresh_token = hashParams.get('refresh_token');
            if (access_token && refresh_token) {
              await supabase.auth.setSession({ access_token, refresh_token });
            }
          }
          router.replace('/'); 
        }
      }
    } catch (e: any) {
      setStatusMsg({ text: e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={styles.card}>
        <Text style={[styles.title, { color: colors.text }]}>Welcome to AIMS</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Sign in to join an active Idea Room.</Text>
        
        {statusMsg && (
          <View style={[styles.statusBox, { backgroundColor: statusMsg.type === 'error' ? '#fee2e2' : '#dcfce7' }]}>
            <Text style={{ color: statusMsg.type === 'error' ? '#991b1b' : '#166534', textAlign: 'center' }}>
              {statusMsg.text}
            </Text>
          </View>
        )}

        <View style={styles.inputContainer}>
          <TextInput
            style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.text }]}
            onChangeText={(text) => setEmail(text)}
            value={email}
            placeholder="email@address.com"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
          />
        </View>
        <View style={styles.inputContainer}>
          <TextInput
            style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.text }]}
            onChangeText={(text) => setPassword(text)}
            value={password}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
          />
        </View>

        <Pressable 
          disabled={loading} 
          style={[styles.buttonPrimary, { backgroundColor: colors.tint }, loading && styles.disabled]}
          onPress={signInWithEmail}
        >
          <Text style={styles.buttonTextPrimary}>{loading ? 'Loading...' : 'Sign in'}</Text>
        </Pressable>

        <Pressable 
          disabled={loading} 
          style={[styles.buttonSecondary, { borderColor: colors.tint }, loading && styles.disabled]}
          onPress={signUpWithEmail}
        >
          <Text style={[styles.buttonTextSecondary, { color: colors.tint }]}>Create Account</Text>
        </Pressable>

        <View style={styles.divider}>
          <View style={[styles.line, { backgroundColor: colors.border }]} />
          <Text style={[styles.orText, { color: colors.textSecondary }]}>OR</Text>
          <View style={[styles.line, { backgroundColor: colors.border }]} />
        </View>

        {Platform.OS === 'ios' && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={colorScheme === 'dark' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={8}
            style={styles.appleButton}
            onPress={signInWithApple}
          />
        )}

        <Pressable 
          disabled={loading} 
          style={[styles.googleButton, { backgroundColor: colorScheme === 'dark' ? '#333' : '#fff', borderColor: colors.border }]}
          onPress={signInWithGoogle}
        >
          <Text style={[styles.googleButtonText, { color: colorScheme === 'dark' ? '#fff' : '#000' }]}>Sign in with Google</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20 },
  card: { padding: 24, borderRadius: 16, backgroundColor: 'transparent' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 16, marginBottom: 24, textAlign: 'center' },
  statusBox: { padding: 12, borderRadius: 8, marginBottom: 16 },
  inputContainer: { marginBottom: 16 },
  input: {
    paddingHorizontal: 16, height: 50, borderRadius: 8, borderWidth: 1, fontSize: 16,
  },
  buttonPrimary: {
    height: 50, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 12,
  },
  buttonSecondary: {
    height: 50, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 16, borderWidth: 1,
  },
  buttonTextPrimary: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },
  buttonTextSecondary: { fontSize: 16, fontWeight: 'bold' },
  disabled: { opacity: 0.5 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
  line: { flex: 1, height: 1 },
  orText: { marginHorizontal: 12, fontSize: 14, fontWeight: '600' },
  appleButton: { width: '100%', height: 50, marginTop: 4 },
  googleButton: {
    height: 50, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 12, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }
  },
  googleButtonText: { fontSize: 16, fontWeight: '600' }
});
