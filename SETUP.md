# MOVA Miles · setup guide

Everything for MOVA Miles is built except the Wallet card (part 7). The steps below connect it
to a real database, put it live and get the shop ready. Allow about an hour for parts 1 to 5.

| Address | Who uses it | What it's for |
|---|---|---|
| `/miles` | Customers | Join, sign in, see the card, QR code, MOVA moment |
| `/staff` | The till tablet | Scan cards, add stamps, use free coffees, undo mistakes |
| `/admin` | You | Members, coffees by moment, add baristas and PINs, download the member list |
| `/privacy` | Everyone | Privacy notice (fill in the gaps first, see part 6) |

---

## Part 1 · Create the database (Supabase, free to start)

1. Go to supabase.com and sign up (use the business email).
2. **New project**. Name: `mova-coffee`. Choose a strong database password and save it in a password manager. **Region: London (eu-west-2)**.
3. When it's ready, open **SQL Editor → New query**. Paste the whole of `supabase/schema.sql`, then press **Run**. You should see "Success. No rows returned".
4. Open **Project Settings → API** and copy two things into `assets/js/config.js`:
   - **Project URL** goes in `supabaseUrl`
   - **anon public** key goes in `supabaseAnonKey`

   Never put the `service_role` key in the website. It bypasses all the security rules.

## Part 2 · Sign-in emails

1. **Authentication → URL Configuration**
   - **Site URL**: your live address, e.g. `https://movacoffee.co.uk`
   - **Redirect URLs**: add `https://movacoffee.co.uk/miles` (and your Vercel preview address, e.g. `https://mova-coffee.vercel.app/miles`, while testing)
2. **Authentication → Email Templates → Magic Link**. Change the subject to `Your MOVA Miles sign-in link` and replace the text with something like:

   ```html
   <h2>Your MOVA Miles card</h2>
   <p>Tap below to open your card. The link works once.</p>
   <p><a href="{{ .ConfirmationURL }}">Open my card</a></p>
   ```
   Do the same for the **Confirm signup** template, which new members receive.
3. **Before launch, set up your own email sender.** Supabase's built-in sender is for testing only and only sends a few emails an hour. Sign up for Resend (resend.com, free tier), verify your domain, then enter its SMTP details in **Project Settings → Authentication → SMTP Settings**. Set the sender to something like `hello@movacoffee.co.uk`.

## Part 3 · Shop logins

You need two logins: one for the till tablet and one for you.

1. **Authentication → Users → Add user → Create new user**
   - `till@movacoffee.co.uk` (any address you control) with a strong password, and tick **Auto confirm user**
   - Your own owner login, e.g. `owner@movacoffee.co.uk`, with a different strong password
2. In **SQL Editor**, run this with your two email addresses:

   ```sql
   insert into public.shop_accounts (user_id, role)
   select id, 'till'  from auth.users where email = 'till@movacoffee.co.uk';
   insert into public.shop_accounts (user_id, role)
   select id, 'owner' from auth.users where email = 'owner@movacoffee.co.uk';
   ```

The owner login works on the till as well, and is the only login that can open `/admin` or undo stamps older than 30 minutes.

## Part 4 · Put it live (Vercel)

1. Put this folder on GitHub (I can do this for you once you've made a GitHub account: just ask).
2. On vercel.com: **Add New → Project → Import** the repository. Framework preset: **Other**. Leave the build command empty. **Deploy**.
3. Add your domain in **Project → Settings → Domains**, then update the Site URL and Redirect URLs from part 2.

## Part 5 · Get the shop ready

1. Sign in at `/admin` with the owner login. Add each barista with a 4 to 6 digit PIN.
2. On the till tablet, open `/staff`, sign in with the till login, then **add it to the home screen** so it opens like an app.
3. **Hardware**
   - Any recent Android tablet or iPad, on a stand at the till.
   - Recommended: a **2D/QR barcode scanner** (USB, or Bluetooth for an iPad), roughly £30–60. It must read **QR codes from phone screens**, so check the listing says "2D" and "screen". It types the code into the till page for you.
   - Without a scanner, tap **Use camera** on the till page. The camera only works on the live https site.
4. **Test run before launch**: join on your own phone at `/miles`, scan yourself on the till, add stamps, try the "is this a new order?" check, complete a card, use the free coffee, and undo one.

## Part 6 · Before you tell customers

- Fill in the gaps marked `[ ]` in `privacy/index.html`: company name and number, the Supabase region, the email provider and how long you keep inactive cards. It's a starting point, not legal advice.
- Train staff: pick name, PIN, scan, set the number of coffees, **Add stamps**. **Switch barista** at shift change.
- Counter sign: "Join MOVA Miles: 8 coffees, 8 stops, the 9th is on us" with a QR code to `/miles`.

## Part 7 · Wallet card (later, with Passcreator)

Already in place: every member has a code (`MV` + 4 characters), and their QR contains `MOVA:<code>`. The till accepts that from a Wallet card exactly as it does from the website. `customers.wallet_pass_id` is ready to store each member's pass, and the card page has a slot for the **Add to Wallet** buttons (`walletEnabled` in `config.js`).

**What you'll do on Passcreator**
1. Create an account and start a **Store card / loyalty** template.
2. Design it with the MOVA logo, terracotta background and cream text. Add fields named `stamps` (e.g. "5/8"), `mover` (e.g. "Early Mover") and `free_coffees`.
3. Set the barcode to **QR**, with its value coming from a field named `member_code`.
4. Copy your **API key** and the **template ID**, and send them to me in a private way. Don't put them in the website code.

**What I'll build then**
- A small server function on Supabase (an Edge Function) that creates a member's pass when they tap **Add to Wallet** and saves its ID.
- An automatic update after every stamp, free coffee or undo, so the pass changes on their phone within seconds.
- The **Add to Apple Wallet / Google Wallet** buttons on `/miles`. Then set `walletEnabled: true`.

---

### Checking the database logic

`tests/schema.test.mjs` runs the whole schema against an in-memory Postgres and checks 18 situations: sign-up, PINs, the 10-minute check, earning and using free coffees, undo rules, UK time and British Summer Time, and account deletion.

```bash
cd tests
npm install
node schema.test.mjs
```
