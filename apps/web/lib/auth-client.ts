import { createAuthClient } from "better-auth/react";
import {
  emailOTPClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL:
    typeof window === "undefined"
      ? process.env.NEXT_PUBLIC_APP_URL ?? "https://app.localhost"
      : window.location.origin,
  // No `twoFactorPage` here — the login page checks `twoFactorRedirect` on the
  // response itself and routes manually, which keeps client-side navigation in
  // play instead of a hard reload.
  plugins: [organizationClient(), twoFactorClient(), emailOTPClient()],
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  organization: org,
  twoFactor: tfa,
  emailOtp,
} = authClient;
