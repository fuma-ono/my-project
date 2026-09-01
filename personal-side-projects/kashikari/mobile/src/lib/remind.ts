import { Alert } from 'react-native';

import type { Strings } from '../i18n/strings';
import { notifyGroup, type RemindTone } from './pushNotifications';

// BalanceCard(内訳の各行)と未払いユーザー一覧モーダルの両方から使う、
// 「催促する」ボタンの共通処理。トーンを選ぶと、相手(debtor)に直接
// プッシュ通知を送る。
//
// 以前はOS標準の共有シート(Share.share)経由でLINE等に文章を貼る
// 方式だったが、プッシュ通知の仕組みができたので、共有シートを開かず
// 直接送れるように変更した(相手が誰かは既に分かっているため)。
//
// onSentはトーンを選んだ時点(=送信を試みた時点)に呼ぶ、利用状況計測用
// のコールバック(結果を待たない)。onResultは実際に送れた/送れなかった
// (相手が通知トークンを登録していない・通知を許可していない等)の結果を
// ユーザーに表示するためのコールバック。
//
// groupIdがnull(デモモード)の場合は、実際には送らずシミュレートする
// (デモモードはSupabaseに一切接続しない設計のため)。
export function openRemindPrompt(
  t: Strings,
  input: { groupId: string | null; debtorId: string; amount: number; currency: string | null },
  onSent?: () => void,
  onResult?: (sent: boolean) => void
) {
  const send = async (tone: RemindTone) => {
    onSent?.();
    if (!input.groupId) {
      onResult?.(true);
      return;
    }
    const { sent } = await notifyGroup({
      groupId: input.groupId,
      kind: 'remind',
      recipientIds: [input.debtorId],
      amount: input.amount,
      currency: input.currency,
      tone,
    });
    onResult?.(sent);
  };
  Alert.alert(t.remind.toneTitle, undefined, [
    { text: t.remind.toneGentle, onPress: () => send('gentle') },
    { text: t.remind.toneNormal, onPress: () => send('normal') },
    { text: t.remind.toneFunny, onPress: () => send('funny') },
    { text: t.remind.toneStrong, onPress: () => send('strong') },
    { text: t.common.cancel, style: 'cancel' },
  ]);
}
