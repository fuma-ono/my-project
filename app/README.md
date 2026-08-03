# Focus & Sleep Sounds (app)

Expo/React Native app that packages the same AI-generated ambient tracks
from `../bgm-pipeline` as a relaxation/focus player, with a freemium model
(some tracks free, others behind a paywall placeholder).

## Setup

```bash
cd app
npm install
npx expo start
```

Scan the QR code with Expo Go, or run `npm run android` / `npm run ios`
(iOS build requires macOS or EAS Build).

## Structure

- `App.tsx` — screen switcher (home / player / paywall), no routing library needed for this size
- `src/data/tracks.ts` — track catalog, references bundled audio in `assets/audio/`
- `src/screens/HomeScreen.tsx` — track list, free vs. premium badges
- `src/screens/PlayerScreen.tsx` — looping playback via `expo-audio`
- `src/screens/PaywallScreen.tsx` — mock upgrade screen (no real billing wired up yet)
- `assets/audio/*.m4a` — 1-minute loopable samples rendered from `bgm-pipeline` presets

## Regenerating bundled audio

```bash
cd ../bgm-pipeline
.venv/bin/python -m bgm_pipeline.generate --preset study_lofi_chill --minutes 1 --out output/app_study_lofi_chill.wav --seed 42
ffmpeg -y -i output/app_study_lofi_chill.wav -c:a aac -b:a 96k ../app/assets/audio/study_lofi_chill.m4a
```

## Building with EAS

`eas.json` is checked in with `development`/`preview`/`production` build
profiles. Once an Expo account exists (human step, see below):

```bash
npm install -g eas-cli
eas login
eas build --platform all --profile preview   # internal test build
eas build --platform all --profile production
```

## What still needs a human before this makes money

- **Expo/EAS account** (free) — `eas login`, then `eas build` can run
- **Apple Developer Program** ($99/yr) + **Google Play Console** ($25 one-time) accounts to submit builds
- Real in-app purchases / subscriptions (`PaywallScreen.tsx` is currently a mock —
  needs `expo-in-app-purchases`/RevenueCat wired to actual App Store Connect / Play
  Console products)
- Ad SDK integration if going the ad-supported free-tier route (e.g. AdMob)
- App icons/screenshots/store listing copy
- Privacy policy / terms of service drafts exist at `docs/legal/privacy-policy.md`
  and `docs/legal/terms-of-service.md` — fill in contact/entity fields and
  host them at a public URL for App Store Connect / Play Console submission
- `eas submit` (or manual Xcode/Android Studio builds) to actually ship to the stores
