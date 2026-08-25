import { Alert, Share } from 'react-native';

import type { Strings } from '../i18n/strings';

// BalanceCard(内訳の各行)と未払いユーザー一覧モーダルの両方から使う、
// 「催促する」ボタンの共通処理。トーンを選ぶと、そのまま文面を組み立てて
// OS標準の共有シート(LINE等を含む)を開く。
export function openRemindPrompt(t: Strings, amountLabel: string) {
  Alert.alert(t.remind.toneTitle, undefined, [
    { text: t.remind.toneGentle, onPress: () => Share.share({ message: t.remind.gentleMessage(amountLabel) }) },
    { text: t.remind.toneNormal, onPress: () => Share.share({ message: t.remind.normalMessage(amountLabel) }) },
    { text: t.remind.toneFunny, onPress: () => Share.share({ message: t.remind.funnyMessage(amountLabel) }) },
    { text: t.remind.toneStrong, onPress: () => Share.share({ message: t.remind.strongMessage(amountLabel) }) },
    { text: t.common.cancel, style: 'cancel' },
  ]);
}
