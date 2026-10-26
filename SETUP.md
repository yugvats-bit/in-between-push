# in-between push · setup (about 15 min)

A separate site with its own link. The alley studio isn't touched.
New link: https://yugvats-bit.github.io/in-between-push/

## 1. New repo (GitHub Desktop)
1. File → New repository → Name: `in-between-push` → Create.
2. Copy everything from this zip into that folder (keep the `supabase` folder; it's harmless).
3. Commit → Publish repository → untick "Keep this code private".
4. On github.com → the repo → Settings → Pages → Branch: `main` / root → Save. Wait about 1 minute.

## 2. Database (Supabase, same project is fine)
SQL Editor → New query → paste `supabase/setup.sql` → Run.
This creates a new table, `push_subscriptions`; nothing else is changed.

## 3. Keys
Open https://yugvats-bit.github.io/in-between-push/setup.html → Generate.
Keep that tab open; you need all three values.

## 4. Edge Function
1. Supabase → Edge Functions → Deploy a new function → Via Editor.
2. Name: `push`. Delete the sample code and paste all of `supabase/push/index.ts` → Deploy.
3. In the function's Details/Settings, turn **off** "Enforce JWT verification" (or "Verify JWT") → Save.
4. Edge Functions → Secrets → add:
   - `VAPID_PRIVATE_JWK` = the private key (the whole `{...}` line)
   - `SEND_SECRET` = the send secret

## 5. config.js
Fill in the three values (Supabase URL, anon/publishable key, VAPID public key) → Commit → Push.

## 6. Test
- **Second phone:** open https://yugvats-bit.github.io/in-between-push/?at=alley-1
  - Android: tap *Let it arrive* → Allow.
  - iPhone: Share → Add to Home Screen → open *waiting* from the Home Screen → *Let it arrive* → Allow.
- **M51:** open https://yugvats-bit.github.io/in-between-push/watch.html, set location `alley-1`, paste the send secret, tap **Test send** under "Seen". The other phone should buzz.
- Then tap **Start watching** and walk.

QR code for the alley: on setup.html, section 2 → Make QR.

## If it doesn't buzz
- The log on watch.html says `delivered to 0/0` → the second phone didn't subscribe. Reopen its page and check that the error line is empty.
- `wrong secret` → the SEND_SECRET doesn't match.
- `server 401` on the second phone → JWT verification is still on (step 4.3).
- After changing files, refresh with the tab closed and reopened, because the old version may be cached.
