// 「記録して清算できたらレビューしますかのポップアップを出してほしい。
// ただ毎回出るとうざい」という依頼への対応。既存の「紹介する」ポップアップ
// (GroupScreen.tsxのreferralAlert、精算が完了して残高が0になった瞬間に
// 出る)と同じタイミングで併せて出すが、こちらは以下のルールで頻度を
// 絞り、うざくならないようにする(このルール自体はこちらの判断):
//   - 一度でも「レビューする」を選んだら、二度と出さない
//   - 直近に出してから45日は経っていないと出さない
//   - 生涯で最大3回まで(それ以降は諦める)
// 判定に使う状態はAsyncStorage(端末ローカル、アカウントには紐付かない
// 端末ごとの設定。i18n/index.tsxの言語設定と同じ考え方)に保存する。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';

const STORAGE_KEY = 'kashikari:reviewPrompt';
const COOLDOWN_MS = 45 * 24 * 60 * 60 * 1000; // 45日
const MAX_SHOWN_COUNT = 3;

// App Store Connect App ID(77回目参照)。Android(Google Play)はまだ
// 未公開のため、package名(app.json参照)は控えているが実際にストアの
// レビューページが存在するのはリリース後になる。
const IOS_APP_ID = '6808062809';
const ANDROID_PACKAGE = 'com.kashikari.mobile';

type State = { shownCount: number; lastShownAt: number | null; reviewed: boolean };

const DEFAULT_STATE: State = { shownCount: 0, lastShownAt: null, reviewed: false };

async function loadState(): Promise<State> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<State>) };
  } catch {
    return DEFAULT_STATE;
  }
}

async function saveState(state: State): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 保存に失敗しても、次回また出るだけなので握りつぶしてよい。
  }
}

// 精算完了の瞬間に呼ぶ。trueならレビューポップアップを出してよい。
export async function shouldShowReviewPrompt(): Promise<boolean> {
  const state = await loadState();
  if (state.reviewed) return false;
  if (state.shownCount >= MAX_SHOWN_COUNT) return false;
  if (state.lastShownAt !== null && Date.now() - state.lastShownAt < COOLDOWN_MS) return false;
  return true;
}

// ポップアップを実際に表示した直後(ボタンの選択に関わらず)に呼ぶ。
export async function markReviewPromptShown(): Promise<void> {
  const state = await loadState();
  await saveState({ ...state, shownCount: state.shownCount + 1, lastShownAt: Date.now() });
}

// 「レビューする」を選んだ時に呼ぶ。以降は二度と出さない。
export async function markReviewed(): Promise<void> {
  const state = await loadState();
  await saveState({ ...state, reviewed: true });
}

// ストアのレビュー投稿ページを開く。itms-apps:／market:スキームが
// 開けない環境(シミュレータ等)向けに、通常のhttps URLへフォールバックする。
export function openStoreReview(): void {
  const appUrl =
    Platform.OS === 'ios' ? `itms-apps://apps.apple.com/app/id${IOS_APP_ID}?action=write-review` : `market://details?id=${ANDROID_PACKAGE}`;
  const webUrl =
    Platform.OS === 'ios'
      ? `https://apps.apple.com/app/id${IOS_APP_ID}?action=write-review`
      : `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
  Linking.openURL(appUrl).catch(() => {
    Linking.openURL(webUrl).catch(() => {});
  });
}
