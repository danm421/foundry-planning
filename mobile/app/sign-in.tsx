import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSignIn } from "@clerk/clerk-expo";
import { useRouter } from "expo-router";

type Stage = "credentials" | "code";

export default function SignIn() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isLoaded) return null;

  async function finish(createdSessionId: string | null) {
    if (!createdSessionId) {
      setError("Sign-in incomplete — try the email code option.");
      return;
    }
    await setActive!({ session: createdSessionId });
    router.replace("/");
  }

  async function signInWithPassword() {
    setBusy(true);
    setError(null);
    try {
      const attempt = await signIn!.create({ identifier: email.trim(), password });
      await finish(attempt.status === "complete" ? attempt.createdSessionId : null);
    } catch (e: unknown) {
      const msg = (e as { errors?: { message?: string }[] }).errors?.[0]?.message;
      setError(msg ?? "Couldn't sign in. Check your email and password.");
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const attempt = await signIn!.create({ identifier: email.trim() });
      const factor = attempt.supportedFirstFactors?.find((f) => f.strategy === "email_code");
      if (!factor || !("emailAddressId" in factor)) {
        setError("Email code sign-in isn't available for this account.");
        return;
      }
      await signIn!.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId: factor.emailAddressId,
      });
      setStage("code");
    } catch {
      setError("Couldn't send a code. Check the email address.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    setBusy(true);
    setError(null);
    try {
      const attempt = await signIn!.attemptFirstFactor({ strategy: "email_code", code: code.trim() });
      await finish(attempt.status === "complete" ? attempt.createdSessionId : null);
    } catch {
      setError("That code didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 justify-center bg-paper px-6"
    >
      <Text className="text-ink text-2xl font-semibold">Foundry Planning</Text>
      <Text className="text-ink-3 mt-1 mb-8">Sign in to your client portal</Text>

      {stage === "credentials" ? (
        <>
          <TextInput
            className="bg-card text-ink border border-hair rounded-xl px-4 py-3 mb-3"
            placeholder="Email"
            placeholderTextColor="#848a98"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            className="bg-card text-ink border border-hair rounded-xl px-4 py-3 mb-4"
            placeholder="Password"
            placeholderTextColor="#848a98"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Pressable
            className="bg-accent rounded-xl py-3.5 items-center"
            disabled={busy || !email || !password}
            onPress={signInWithPassword}
          >
            {busy ? <ActivityIndicator /> : <Text className="text-paper font-semibold">Sign in</Text>}
          </Pressable>
          <Pressable className="mt-4 items-center" disabled={busy || !email} onPress={sendCode}>
            <Text className="text-accent-ink">Email me a sign-in code instead</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text className="text-ink-2 mb-3">Enter the code we emailed to {email.trim()}</Text>
          <TextInput
            className="bg-card text-ink border border-hair rounded-xl px-4 py-3 mb-4 tracking-widest"
            placeholder="123456"
            placeholderTextColor="#848a98"
            keyboardType="number-pad"
            value={code}
            onChangeText={setCode}
          />
          <Pressable
            className="bg-accent rounded-xl py-3.5 items-center"
            disabled={busy || code.length < 6}
            onPress={submitCode}
          >
            {busy ? <ActivityIndicator /> : <Text className="text-paper font-semibold">Verify</Text>}
          </Pressable>
          <Pressable className="mt-4 items-center" onPress={() => setStage("credentials")}>
            <Text className="text-ink-3">Back</Text>
          </Pressable>
        </>
      )}

      {error ? <Text className="text-crit mt-4">{error}</Text> : null}
    </KeyboardAvoidingView>
  );
}
