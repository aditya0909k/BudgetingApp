# Personal Budgeting App

A personal finance tracker that connects to your real bank account and runs as a native app on your iPhone. Shows weekly and monthly spending, lets you exclude transactions, and works anywhere — the backend runs in the cloud 24/7.

---

## How It Works

Two pieces:

1. **Backend (server)** — runs on Fly.io (free cloud hosting) and fetches transactions from your bank via Teller. Always online, no Mac required.
2. **iPhone app** — talks to the backend to display your data.

Set both up once. After that the app just works.

---

## What You Need

- A Mac with Xcode installed (free from Mac App Store, ~15 GB)
- An iPhone
- A free Apple ID (the one you use for the App Store is fine)
- A free Fly.io account
- A free Teller account
- Node.js and flyctl installed on your Mac

---

## Mac Setup

Open **Terminal** (press `Command + Space`, type Terminal, press Enter).

### Install Homebrew
```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
Enter your Mac password when prompted (you won't see it as you type). Takes a few minutes.

### Install Node.js
```
brew install node
```

### Install flyctl
```
brew install flyctl
```

### Install Xcode
Open the **Mac App Store**, search "Xcode", install it. Takes a while (~15 GB).

---

## Part 1 — Teller (Bank Connection)

Teller securely connects to your bank.

1. Go to [teller.io](https://teller.io) and sign up
2. Create a new **Application** (any name)
3. Copy your **Application ID** — looks like `app_xxxxxxxxxxxxxxxxxxxx`
4. Go to **Settings → Certificates**, download the certificate bundle
5. Rename the two files exactly:
   - `certificate.pem`
   - `private_key.pem`
6. Move both into the `BudgetingApp/server/` folder

> **Keep these files private.** Never share or commit them. They are like passwords to your bank connection.

---

## Part 2 — Backend (Fly.io)

### Create a Fly.io account
Go to [fly.io](https://fly.io), sign up, add a payment method (required even for free tier — this app won't cost anything).

### Log in
```
fly auth login
```

### Navigate to the server folder
```
cd ~/Documents/BudgetingApp/server
```

### Create the app
```
fly launch --name my-budget-server --region ewr --no-deploy
```
Replace `my-budget-server` with any name you like (lowercase, hyphens only). `ewr` = New Jersey. Other options: `ord` (Chicago), `lax` (LA), `sea` (Seattle).

Answer the prompts: No to Postgres, No to Redis, No to Tigris, Yes to existing config.

### Create a storage volume
This is where your data lives permanently in the cloud.
```
fly volumes create data_vol --size 1 --region ewr
```
Use the same region. Type `y` if it warns about single-volume risk.

### Upload your secrets
```
fly secrets set TELLER_APPLICATION_ID=app_xxxxxxxxxxxxxxxxxxxx TELLER_ENV=development LINK_PIN=your_pin
```
Replace `app_xxxxxxxxxxxxxxxxxxxx` with your Application ID. Replace `your_pin` with any PIN you want — this protects the bank linking page.

Then upload your certificates (run one at a time, from inside the `server/` folder):
```
fly secrets set TELLER_CERT=- < certificate.pem
fly secrets set TELLER_KEY=- < private_key.pem
```

### Deploy
```
fly deploy
```
Takes ~2 minutes. Your server is now live at `https://my-budget-server-XXXX.fly.dev` (it will show you the exact path on the console). 

### Link your bank account
1. Open Safari on your iPhone
2. Go to `https://my-budget-server-XXXX.fly.dev/link`
3. Enter your PIN
4. Follow the steps to connect your bank

This is a one-time step. Your connection is saved permanently on the Fly.io volume.

---

## Part 3 — iPhone App

### Important: no spaces in the folder path
Xcode breaks if your project folder path has spaces. Make sure the folder is named `BudgetingApp` (not `Budgeting App`).

### Install app dependencies
```
cd ~/Documents/BudgetingApp/mobile
npm install
```

### Generate the Xcode project
```
npx expo prebuild --platform ios --clean
```
This creates an `ios/` folder. Re-run this any time you make code changes before rebuilding.

### Open in Xcode
Open this file by double-clicking it in Finder:
```
~/Documents/BudgetingApp/mobile/ios/BudgetingApp.xcworkspace
```
Always open the `.xcworkspace` file, never the `.xcodeproj`.

### Configure signing
1. In Xcode, click the project name at the top of the left panel
2. Click the **Signing & Capabilities** tab
3. Under **Team**, select your Apple ID (add it under Xcode → Settings → Accounts if needed)

### Set Release mode (important — makes the app standalone)
1. Menu bar: **Product → Scheme → Edit Scheme**
2. Click **Run** on the left
3. Change **Build Configuration** from `Debug` to `Release`
4. Close

In Debug mode the app needs your Mac running to load its code. In Release mode everything is bundled inside the app — it works completely independently.

### Install on your iPhone
1. Plug iPhone into Mac via USB
2. Tap **Trust** on your iPhone if prompted
3. In Xcode's top bar, click the device selector and choose your iPhone
4. Hit **Run ▶**

The app builds and installs. First build takes a few minutes; subsequent ones are faster.

On your iPhone the first time: **Settings → General → VPN & Device Management** → tap your Apple ID → **Trust**. You might also need to enter developer mode on your phone. This requires a phone restart.

### The 7-day renewal
The free Apple ID certificate expires every 7 days. When it expires the app won't open until renewed.

To renew:
1. Plug iPhone into Mac
2. Open `BudgetingApp.xcworkspace` in Xcode
3. Hit **Run ▶**

Takes 30 seconds.

**Second option: Sideloadly (auto-renewal over WiFi)**

Sideloadly is a free Mac app that installs the IPA and auto-renews the certificate in the background whenever your iPhone is on the same WiFi as your Mac — no plugging in needed.

1. Download **Sideloadly** from [sideloadly.io](https://sideloadly.io) and install it
2. In Xcode, do **Product → Archive** to build the app
3. Run this in Terminal to package it as an IPA:
```bash
python3 -c "
import os, shutil, subprocess
base = os.path.expanduser('~/Library/Developer/Xcode/Archives')
date = sorted(os.listdir(base))[-1]
archive = [f for f in os.listdir(os.path.join(base, date)) if f.endswith('.xcarchive')][0]
app = os.path.join(base, date, archive, 'Products/Applications/BudgetingApp.app')
desktop = os.path.expanduser('~/Desktop')
payload = os.path.join(desktop, 'Payload')
ipa = os.path.join(desktop, 'BudgetingApp.ipa')
if os.path.exists(payload): shutil.rmtree(payload)
if os.path.exists(ipa): os.remove(ipa)
os.makedirs(payload)
shutil.copytree(app, os.path.join(payload, 'BudgetingApp.app'), symlinks=True)
subprocess.run(['zip', '-ry', ipa, 'Payload'], cwd=desktop)
shutil.rmtree(payload)
print('Done:', ipa)
"
```
4. Plug iPhone into Mac, open Sideloadly, drag `BudgetingApp.ipa` from your Desktop into it
5. Enter your Apple ID and click **Start**
6. Keep Sideloadly running in the background on your computer — it handles renewal automatically

---

## Updating the App After Code Changes

### Backend changes only:
```
cd ~/Documents/BudgetingApp/server
fly deploy
```

### Frontend code changes:
```
cd ~/Documents/BudgetingApp/mobile
npx expo prebuild --platform ios --clean
```
Then open Xcode → plug in iPhone → Run ▶.

---

## Troubleshooting

### "command not found: brew"
Run the Homebrew install command from the Mac Setup section.

### "command not found: node" or "command not found: npm"
Run `brew install node`.

### "command not found: fly"
Run `brew install flyctl`.

### Xcode says the app requires a newer iOS version
In `mobile/app.json`, make sure the `"ios"` section contains `"deploymentTarget": "16.0"`. Then re-run `npx expo prebuild --platform ios --clean`.

### Xcode build fails with "No such file or directory" and a path that cuts off at a space
Your project folder path has a space in it. Rename the folder to remove the space (e.g. `BudgetingApp` not `Budgeting App`). Then re-run `npx expo prebuild --platform ios --clean`.

### "specified item could not be found in the keychain"
Go to Xcode → Settings → Accounts → Manage Certificates → click **+** → **Apple Development**. This creates a fresh certificate. Try Run ▶ again.

### App shows "Could not reach server"
- Run `fly status` — server should be running
- Check `mobile/src/config.js` has the correct Fly.io URL
- Check logs: `fly logs`

### No transactions appear
- Make sure you completed the bank linking step (Part 2)
- Pull down to refresh in the app
- If you see "reconnection required", go to `https://your-app.fly.dev/link` and re-link your bank

### App won't open (certificate expired)
Plug iPhone into Mac and hit Run ▶ in Xcode. Done.

### Weekly/monthly history totals don't match the detail screen
Open the detail screen for that week or month — it recalculates and corrects the stored total automatically. Go back and the list will show the updated number.

### Forgot the bank link PIN
```
fly secrets set LINK_PIN=new_pin
fly deploy
```

### Data missing after a redeploy
Data lives on the Fly.io volume and survives deploys. To check:
```
fly ssh issue --agent
fly ssh console -C "ls /data"
```
If `/data` is empty, re-link your bank via the `/link` page.

---

## Data & Privacy

All financial data stays on your own server. Nothing goes to any third party. Data files on the Fly.io volume:

| File | Contents |
|---|---|
| `accounts.json` | Bank connection token |
| `budget.json` | Weekly budget amount |
| `excluded.json` | Transactions excluded from totals |
| `weeklyHistory.json` | Past weekly spending snapshots |
| `monthlyHistory.json` | Past monthly spending snapshots |
| `transactions_cache.json` | Cached transactions (auto-rebuilt) |
