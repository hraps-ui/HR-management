# Aeroplast HR Portal — Supabase shared database setup

The website frontend is configured for this Supabase project:

- Project URL: https://rrcolbhgfzdbjprbuzer.supabase.co
- Edge Function: `portal-api`
- Browser key: publishable key (safe to expose in website code; it does not grant table access).

## Complete these one-time dashboard steps

### 1. Create the tables and access policies

1. Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/rrcolbhgfzdbjprbuzer/sql/new).
2. Open `supabase/migrations/20261020_shared_hr_portal.sql` from this repository.
3. Copy the full SQL script into the SQL Editor and click **Run**.
4. Confirm it completes successfully. Do not put employee data into GitHub or paste database secrets into this repository.

### 2. Add private Edge Function secrets

In Supabase Dashboard, open the project, then **Edge Functions → Secrets**. Add these two secrets:

- `PORTAL_BOOTSTRAP_ADMIN_ID` — choose a new HR administrator login ID (at least 3 characters).
- `PORTAL_BOOTSTRAP_ADMIN_PASSWORD` — create a unique strong password, at least 12 characters.

The function uses Supabase's server-side database key from the Edge Function runtime. Do not add a secret/service-role key to `index.html`, GitHub source files, or the chat. The bootstrap ID/password should also stay private.

### 3. Allow GitHub Actions to deploy the function

1. Create a Supabase Personal Access Token in [Supabase account tokens](https://supabase.com/dashboard/account/tokens).
2. In GitHub, open this repository: [HR-management repository settings](https://github.com/hraps-ui/HR-management/settings/secrets/actions).
3. Under **Secrets and variables → Actions**, choose **New repository secret**.
4. Name it `SUPABASE_ACCESS_TOKEN` and paste the token value. Never put the token in a code file.
5. Open the repository's **Actions** tab and select **Deploy Supabase HR Portal API**. Run the workflow, or rerun the deployment after adding the secret if the first automatic attempt failed.
6. Wait for a green/successful run. It deploys `supabase/functions/portal-api/index.ts` to project `rrcolbhgfzdbjprbuzer`.

## First login and data import

After SQL succeeds, the private function secrets are saved, and the GitHub Action succeeds:

1. Open the [Aeroplast HR Portal](https://hraps-ui.github.io/HR-management/).
2. Sign in with the bootstrap administrator ID/password you chose in step 2. This login creates the first cloud administrator account the first time it is used.
3. On the first login, the portal asks whether to import this browser's existing local HR records into the empty shared database. Choose **OK** only from the browser/device holding the correct and most complete employee/HR data. The source local copy is kept as a browser cache; if you cancel, migration is cancelled and local data is left untouched.
4. Once loaded, test by adding a clearly-labelled temporary test record, opening the portal on another device/browser, and confirming it appears. Remove the test record afterwards.

## Important limitations and safety notes

- The browser publishable key is public by design. The secret database key and bootstrap password are server-side only.
- This setup uses application-managed login sessions for the HR portal; it is separate from Supabase Auth.
- Use a strong private bootstrap password and change it using the portal's Admin Login Settings after sign-in.
- Do not clear the original browser's site data until cross-device sync and the employee directory have been verified.
- If two administrators edit the same data at once, the portal displays a conflict warning rather than silently overwriting the newer cloud version. A local recovery snapshot is saved in that browser.
- This is an initial working setup, not a substitute for a production security review. Before storing highly sensitive records at scale, test role scoping, backups, account deactivation, and all key HR workflows with dummy records.

## Troubleshooting the current deployment failure

The last recorded Supabase deployment attempt failed because GitHub Actions had an empty `SUPABASE_ACCESS_TOKEN` environment value. This is a missing repository secret, not an HTML syntax problem.

Fix it here:
1. Open [GitHub Actions repository secrets](https://github.com/hraps-ui/HR-management/settings/secrets/actions).
2. Choose **New repository secret**.
3. Set the exact name to `SUPABASE_ACCESS_TOKEN` (uppercase, underscores, no spaces).
4. Paste the Supabase Personal Access Token value, then save.
5. Open [the Supabase deployment workflow](https://github.com/hraps-ui/HR-management/actions/workflows/deploy-supabase-function.yml) and click **Run workflow**.
6. Confirm the run ends with a green check. If it fails again, open the failed run and inspect the **Deploy portal-api Edge Function** step.

Do not use the project URL, publishable key, database password, or service-role key as the GitHub Actions access token. The token is created separately under Supabase Account Tokens. I cannot create or read this private token on your behalf.
