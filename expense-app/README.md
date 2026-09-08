# サクッと経費 (expense-app)

Expo/React Native app for solo business owners / side-hustlers (個人事業主・副業ワーカー)
to log income and expenses in a few taps and export a CSV for tax filing (確定申告).
Not a full accounting suite (freee/やよい) and not a personal budgeting app (Zaim) —
the gap is a dead-simple, mobile-only daily ledger for a one-person business.

Direction and rationale: `docs/marketing/2026-08-app-pivot-decision.md`.

## Setup

```bash
cd expense-app
npm install
npx expo start
```

Scan the QR code with Expo Go, or run `npm run android` / `npm run ios`
(iOS build requires macOS or EAS Build).

## Structure

- `App.tsx` — screen switcher (home / add entry), no routing library needed for this size
- `src/types.ts` — `Entry` model (income/expense, amount, category, date, memo)
- `src/categories.ts` — expense/income category lists (勘定科目)
- `src/storage.ts` — `AsyncStorage`-backed local persistence, monthly summary, CSV export
- `src/screens/HomeScreen.tsx` — monthly income/expense/balance summary + entry list
- `src/screens/AddEntryScreen.tsx` — entry form (type, amount, category, date, memo)

All data stays on-device (`AsyncStorage`); there is no backend. CSV export uses
`expo-file-system` + `expo-sharing` to hand the file to the OS share sheet.

## What still needs a human before this makes money

- **Apple Developer Program** ($99/yr) + **Google Play Console** ($25 one-time) accounts to submit builds
- App icons/screenshots/store listing copy
- A pricing/paywall decision if this moves beyond a free MVP (not implemented yet)
- `eas build` + `eas submit` (or manual Xcode/Android Studio builds) to actually ship
