import { Alert, Share } from 'react-native';

import type { Strings } from '../i18n/strings';

// BalanceCard(内訳の各行)と未払いユーザー一覧モーダルの両方から使う、
// 「催促する」ボタンの共通処理。トーンを選ぶと、そのまま文面を組み立てて
// OS標準の共有シート(LINE等を含む)を開く。onSentは「利用状況」計測用
// (どのトーンを選んでも、キャンセル以外なら催促を送ったとみなす)。
// この関数自体はデモモードでも呼ばれる共有コードのため、実際に計測
// するかどうかは呼び出し側(GroupScreen/DemoGroupScreen)がonSentの
// 中身(logEventを呼ぶか、何もしないか)で決める。
export function openRemindPrompt(t: Strings, amountLabel: string, onSent?: () => void) {
  const send = (message: string) => {
    Share.share({ message });
    onSent?.();
  };
  Alert.alert(t.remind.toneTitle, undefined, [
    { text: t.remind.toneGentle, onPress: () => send(t.remind.gentleMessage(amountLabel)) },
    { text: t.remind.toneNormal, onPress: () => send(t.remind.normalMessage(amountLabel)) },
    { text: t.remind.toneFunny, onPress: () => send(t.remind.funnyMessage(amountLabel)) },
    { text: t.remind.toneStrong, onPress: () => send(t.remind.strongMessage(amountLabel)) },
    { text: t.common.cancel, style: 'cancel' },
  ]);
}
