import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Alert, Platform, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AddEntrySheet from '../components/AddEntrySheet';
import AutoSettlePlan from '../components/AutoSettlePlan';
import Avatar from '../components/Avatar';
import AvatarPicker from '../components/AvatarPicker';
import BalanceCard from '../components/BalanceCard';
import BottomTabBar, { type GroupTab } from '../components/BottomTabBar';
import EntryRow from '../components/EntryRow';
import Fab from '../components/Fab';
import HistoryEntryRow from '../components/HistoryEntryRow';
import InviteModal from '../components/InviteModal';
import NetSummary from '../components/NetSummary';
import SettlementProgress from '../components/SettlementProgress';
import ShareChannelSheet from '../components/ShareChannelSheet';
import Toast from '../components/Toast';
import UnpaidMembersModal from '../components/UnpaidMembersModal';
import { useGroupData } from '../hooks/useGroupData';
import { useT } from '../i18n';
import { logEvent } from '../lib/analytics';
import { computeBalances, computeMyNet, computeSimplifiedSettlement } from '../lib/balances';
import { groupEntriesByDate } from '../lib/dateGroups';
import { buildInviteUrl } from '../lib/invite';
import { markReviewPromptShown, markReviewed, openStoreReview, shouldShowReviewPrompt } from '../lib/reviewPrompt';
import { avatarColor, colors, fonts } from '../theme';
import type { BalanceRow, Group, SimplifiedTransaction } from '../types';

type Tab = GroupTab;

// セーフエリア(insets.top、ステータスバー・ノッチ・Dynamic Island分の
// 実測値)だけだとアイコン等がステータスバーの直下にぴったりくっついて
// 窮屈に見えるため、見た目の余白としてこれを追加で足す。
const EXTRA_TOP_PADDING = 8;

type Props = {
  group: Group;
  meId: string | null;
  justCreated?: boolean; // グループ作成直後に開かれた場合、招待導線を1回だけ出す
  onBack: () => void;
  onLeave: (groupId: string) => Promise<{ error: string | null }>;
  onChangeAvatar: (emoji: string) => Promise<{ error: string | null }>;
  onChangeAvatarPhoto: (uri: string) => Promise<{ error: string | null }>;
  onOpenSettings: () => void;
  onOpenNotifications: () => void;
  hasUnreadNotifications: boolean;
};

export default function GroupScreen({
  group,
  meId,
  justCreated,
  onBack,
  onLeave,
  onChangeAvatar,
  onChangeAvatarPhoto,
  onOpenSettings,
  onOpenNotifications,
  hasUnreadNotifications,
}: Props) {
  const t = useT();
  // 「グループ名や通知・設定ボタンがステータスバーに被る」という指摘への
  // 対応。以前はheaderGradientBaseのpaddingTopを固定値(28)で持たせて
  // いたが、これは特定の端末で目視調整した値に過ぎず、Dynamic Island
  // 搭載機種など画面上部の切り欠き(セーフエリア)が広い端末では全く
  // 足りていなかった。react-native-safe-area-contextの実測値(insets.top)
  // を使い、どの端末でも確実にステータスバー分の余白を確保した上で、
  // 見た目の余白(EXTRA_TOP_PADDING)を追加する形にした。
  const insets = useSafeAreaInsets();
  const {
    members,
    entries,
    invites,
    loading,
    refresh,
    addEntry,
    addSplitEntry,
    toggleSettled,
    deleteEntry,
    updateEntry,
    settlePair,
    settleAllMoney,
    markPaid,
    confirmReceived,
    inviteMember,
  } = useGroupData(group.id, meId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [tab, setTab] = useState<Tab>('balance');
  const [showSettled, setShowSettled] = useState(false);
  const [unpaidModalOpen, setUnpaidModalOpen] = useState(false);
  // 催促(openRemindPrompt)の結果、実際にプッシュ通知を送れたかどうかを
  // 表示するトースト(60回目でプッシュ通知を追加し、催促がOS共有シート
  // 経由のテキストからプッシュ通知に一本化されたのに合わせて追加)。
  const [remindToastMessage, setRemindToastMessage] = useState<string | null>(null);
  // 「招待成功後は『けんたを招待しました』のような完了表示を出す」という
  // 指摘への対応。メッセージ自体を都度差し替えるため、通知トーストとは
  // 別枠のstateにしている。
  const [inviteToastMessage, setInviteToastMessage] = useState<string | null>(null);
  // 「グループに1人でも追加しないと＋が押せないのはなんで？」という
  // 質問への対応。＋が無効な理由をタップ時にトーストで説明する。
  const [fabHintToastVisible, setFabHintToastVisible] = useState(false);
  // 精算状態の変更・削除・オート精算が失敗した時のトースト。以前は
  // これらの操作の戻り値(error)を誰も見ておらず、失敗しても画面上に
  // 何も表示されなかった(気づけないまま「編集ができない」と分かる
  // までに時間がかかったことがあった)ため追加した(71回目)。
  const [entryErrorToastMessage, setEntryErrorToastMessage] = useState<string | null>(null);
  const showEntryErrorIfAny = (result: { error: string | null }) => {
    if (result.error) setEntryErrorToastMessage(t.group.actionFailedToast(result.error));
  };
  // 招待送信の直後、InviteModal自身の閉じるアニメーションが完全に
  // 終わってから共有シートを開くためのフラグ(詳細はinviteModalの
  // onDismissのコメント参照)。
  const pendingShareRef = useRef(false);

  // 「招待した相手が参加する前でも記録できる」対応。相手のIDが実メンバー
  // (members)に無ければ、招待中の相手(invites, group_invites.id)を見る
  // (詳細はlib/balances.tsのentryFromKey/entryToKeyのコメント参照)。
  const nameOf = (id: string) =>
    members.find((m) => m.id === id)?.display_name ?? invites.find((i) => i.id === id)?.invited_name ?? t.group.unknownMember;
  const emojiOf = (id: string) => members.find((m) => m.id === id)?.avatar_emoji ?? null;
  const me = members.find((m) => m.id === meId);
  const balances = useMemo(() => computeBalances(entries, meId), [entries, meId]);
  const netTotals = useMemo(() => computeMyNet(entries, meId), [entries, meId]);

  // 自動精算プラン: 通貨ごとに「まとめると何回の支払いで済むか」を計算し、
  // それが素朴なペアごとの内訳(balances)の件数より実際に少ない通貨だけ
  // カードを出す(2人だけのグループ等、まとめても件数が変わらない場合は
  // 表示しても意味がないため)。
  const autoSettlePlans = useMemo(() => {
    const simplified = computeSimplifiedSettlement(entries);
    const byCurrency = new Map<string, SimplifiedTransaction[]>();
    for (const tx of simplified) {
      const list = byCurrency.get(tx.currency) ?? [];
      list.push(tx);
      byCurrency.set(tx.currency, list);
    }
    const pairwiseCountByCurrency = new Map<string, number>();
    for (const row of balances) {
      if (row.type !== 'money' || !row.currency) continue;
      pairwiseCountByCurrency.set(row.currency, (pairwiseCountByCurrency.get(row.currency) ?? 0) + 1);
    }
    return [...byCurrency.entries()]
      .filter(([currency, txs]) => txs.length < (pairwiseCountByCurrency.get(currency) ?? Infinity))
      .map(([currency, transactions]) => ({ currency, transactions }));
  }, [entries, balances]);

  // 「受け取る」「支払う」を混ぜて出すと認知負荷が高い、という指摘を
  // 受けて、内訳を自分視点のセクションに分ける。自分が関係しない行
  // (グループ内の他の2人同士)は「受け取る/支払う」のどちらにも属さない
  // ため、別セクションにまとめる。
  const { balanceSections, receivingRows } = useMemo(() => {
    const receiving: BalanceRow[] = [];
    const paying: BalanceRow[] = [];
    const other: BalanceRow[] = [];
    for (const row of balances) {
      if (row.mine && row.creditor === meId) receiving.push(row);
      else if (row.mine && row.debtor === meId) paying.push(row);
      else other.push(row);
    }
    return {
      balanceSections: [
        { title: t.group.receivingSection, data: receiving },
        { title: t.group.payingSection, data: paying },
        { title: t.group.otherSection, data: other },
      ].filter((s) => s.data.length > 0),
      receivingRows: receiving,
    };
  }, [balances, meId, t]);

  // 精算進捗: まだ完了(confirmed)していない内訳のうち、既に「支払った」
  // 済みで受け取る側の確認待ちのものがどれだけあるか。進捗が見えると
  // 完了したくなる、という狙い。全員精算済みならNetSummary側の🎉
  // メッセージと役割が重複するため、balances.length > 0のときだけ
  // 出す(呼び出し側で判定)。
  const settlementProgress = useMemo(() => {
    const remaining = balances.length;
    const paid = balances.filter((r) => r.type === 'money' && r.status === 'paid').length;
    return { remaining, paid };
  }, [balances]);

  const visibleEntries = useMemo(
    () => (showSettled ? entries : entries.filter((e) => e.settle_status !== 'confirmed')),
    [entries, showSettled]
  );
  const sections = useMemo(
    () => groupEntriesByDate(visibleEntries, { today: t.dateGroups.today, yesterday: t.dateGroups.yesterday }),
    [visibleEntries, t]
  );
  const settledCount = entries.filter((e) => e.settle_status === 'confirmed').length;

  // 履歴タブ: 双方確認が完了(confirmed)した記録だけを、確認日の新しい順に
  // 並べる。日付グルーピングはconfirmed_at基準にしたいが、groupEntriesByDate
  // はcreated_atしか見ないため、この呼び出し専用にcreated_atをconfirmed_at
  // で置き換えたコピーを渡す(表示に使うentry自体は元のまま)。
  const historySections = useMemo(() => {
    const confirmed = entries
      .filter((e) => e.settle_status === 'confirmed' && e.confirmed_at)
      .slice()
      .sort((a, b) => ((a.confirmed_at as string) < (b.confirmed_at as string) ? 1 : -1));
    return groupEntriesByDate(
      confirmed.map((e) => ({ ...e, created_at: e.confirmed_at as string })),
      { today: t.dateGroups.today, yesterday: t.dateGroups.yesterday }
    );
  }, [entries, t]);

  // グループ作成直後だけ、1回きりの招待導線を出す(成長施策⑥)。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!justCreated) return;
    Alert.alert(t.group.inviteAfterCreateTitle, t.group.inviteAfterCreateMessage(group.name), [
      { text: t.group.inviteAfterCreateLater, style: 'cancel' },
      { text: t.group.inviteAfterCreateNow, onPress: () => setInviteModalOpen(true) },
    ]);
  }, []);

  // 貸し借りが1件もない状態(balances.length === 0)に「今まさに」なった
  // 瞬間だけ、紹介導線を出す(成長施策⑦)。開いた時点で既に精算済みだった
  // 場合は出さない(prevが分かっているとき=2回目以降のレンダーだけ発火)。
  const prevBalanceCountRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevBalanceCountRef.current;
    if (prev !== null && prev > 0 && balances.length === 0) {
      logEvent('settlement_completed', { userId: meId, groupId: group.id });
      // 「紹介する」ポップアップを閉じた(=「閉じる」を押した)後、条件を
      // 満たしていればレビュー依頼ポップアップも続けて出す(reviewPrompt.ts
      // 参照。同時に2つ出すと衝突するため必ず片方を閉じてから)。「紹介する」
      // を選んだ場合は招待シートが開くため、その導線を邪魔しないよう
      // こちらは出さない。
      const maybeShowReviewPrompt = () => {
        void shouldShowReviewPrompt().then((should) => {
          if (!should) return;
          void markReviewPromptShown();
          Alert.alert(t.group.reviewPromptTitle, t.group.reviewPromptMessage, [
            { text: t.group.reviewPromptDismiss, style: 'cancel' },
            {
              text: t.group.reviewPromptNow,
              onPress: () => {
                void markReviewed();
                openStoreReview();
              },
            },
          ]);
        });
      };
      Alert.alert(t.group.referralTitle, t.group.referralMessage, [
        { text: t.group.referralDismiss, style: 'cancel', onPress: maybeShowReviewPrompt },
        { text: t.group.referralNow, onPress: () => setInviteModalOpen(true) },
      ]);
    }
    prevBalanceCountRef.current = balances.length;
  }, [balances.length, group.id, group.name, meId, t]);

  const avatarPicker = (
    <AvatarPicker
      visible={avatarPickerOpen}
      name={me?.display_name ?? '?'}
      selected={me?.avatar_emoji ?? null}
      onSelect={async (emoji) => {
        setAvatarPickerOpen(false);
        await onChangeAvatar(emoji);
      }}
      onSelectPhoto={async (uri) => {
        setAvatarPickerOpen(false);
        await onChangeAvatarPhoto(uri);
      }}
      onClose={() => setAvatarPickerOpen(false)}
    />
  );

  // 送信成功後、InviteModal(独自の<Modal>)はこの直後にclose()を呼ぶ。
  // その閉じるアニメーション中に別のネイティブ画面(共有シート等)を
  // 呼ぶと、iOSでは「自分のモーダルを閉じている最中に別のモーダルを
  // 開こうとする」形になり、共有シートが一切表示されないまま消えて
  // しまう(名前だけ登録されて共有が開かない、という不具合の原因)。
  // 以前はsetTimeout(500ms)で回避していたが、実機で「共有フォームが
  // 出ない」という報告を受け、固定時間待つのではなく、iOSの
  // <Modal>が実際に閉じ終わった瞬間を通知するonDismiss(iOS専用)を
  // 使う形に変更した。Androidはこのコールバックが無いため、従来通り
  // 短いsetTimeoutにフォールバックする。
  // 「共有する時にLINEやメールへのリンクを送れるようにしてほしい」への
  // 対応で、以前はここでOS標準の共有シート(Share.share)を直接開いて
  // いたが、今はShareChannelSheet(LINE/メール/コピー/その他を選べる
  // 独自シート)を開くようにしている。
  const triggerPendingShare = () => {
    if (!pendingShareRef.current) return;
    pendingShareRef.current = false;
    const url = buildInviteUrl(group.invite_code);
    setShareMessage(t.group.inviteMessage(group.name, url, group.invite_code));
    setShareSheetOpen(true);
  };

  const inviteModal = (
    <InviteModal
      visible={inviteModalOpen}
      onClose={() => setInviteModalOpen(false)}
      onDismiss={triggerPendingShare}
      onSubmit={async (invitedName) => {
        const res = await inviteMember(invitedName);
        if (!res.error) {
          setInviteToastMessage(t.group.inviteSuccessToast(invitedName));
          pendingShareRef.current = true;
          if (Platform.OS !== 'ios') setTimeout(triggerPendingShare, 400);
        }
        return res;
      }}
    />
  );

  const shareChannelSheet = (
    <ShareChannelSheet
      visible={shareSheetOpen}
      message={shareMessage}
      onClose={() => setShareSheetOpen(false)}
      onCopied={() => setInviteToastMessage(t.group.inviteLinkCopiedToast)}
    />
  );

  const leave = () => {
    Alert.alert(t.group.leaveConfirmTitle, t.group.leaveConfirmMessage(group.name), [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.group.leaveConfirmButton,
        style: 'destructive',
        onPress: async () => {
          const res = await onLeave(group.id);
          if (res.error) {
            Alert.alert(t.group.leaveFailedTitle, res.error);
            return;
          }
          onBack();
        },
      },
    ]);
  };

  // 以前は歯車アイコンをタップすると「設定/抜ける」のメニューが出る形に
  // していたが、「設定マークは設定のみに動くべきで、抜けるは別のマークで
  // 作るべき」という指摘を受け、歯車は素直に設定画面を開くだけにし、
  // 抜ける操作は専用のアイコン(exit-outline)を別途ヘッダーに置く形に
  // 変更した。抜ける操作自体はグループ詳細(この画面)にしか無くてよい
  // (ホーム側のグループ一覧はグループ単位の操作をしないため不要)。

  const pendingInvites = useMemo(() => invites.filter((i) => i.status === 'pending'), [invites]);

  const header = (
    <View>
      {/* 参考UIでは「戻る/タイトル/通知/設定」がグラデーションの帯の中に
          白抜きで収まっていて、その下に白い本体が続く2層構成になっている。
          以前はここも本体と同じクリーム色の背景で、残高カードだけが
          グラデーションだったが、参考画像に合わせてヘッダー自体にも
          ブランドのグラデーションを敷いた。グループアイコンの絵文字
          (Mark)は参考画像に無いため非表示にしたが、タップでアイコンを
          変更する機能自体はタイトル部分に残している。
          「グループ名の位置がおかしい、＜の横に」という指摘を受け、
          戻る矢印とタイトルを別の行に分けていたのをやめ、矢印のすぐ
          右にタイトルが来る1行のレイアウトに変更した。
          「左右は丸めなくていい、画面の端まで塗り広げて、下をメインの
          画面の下にかぶせられるような形に」という指摘を受け、左右にも
          余白を持たせた「浮いたカード」案からは撤回し、画面の端まで
          塗り広げて下の角だけ丸める形に戻した。「かぶせる」感じを出す
          ため、影(shadow/elevation)を付けて、本体の上に一枚重なって
          いるように見せている(影を描画するため、影自体を持つ外側の
          View と、角丸+overflow:hiddenでグラデーションをクリップする
          内側のViewを分けている)。 */}
      <View style={styles.headerShadowWrap}>
        {/* 参考画像から実際に色を採取したところ、ヘッダーは単純な単色
            グラデーションではなく、「左右方向のグラデーション(横)」の
            上に「上から下へ薄くなる黒のオーバーレイ(縦)」を重ねた
            2層構成だった(上ほど暗く、下の白い本体に近づくほど元の
            グラデーション色そのままに明るくなる)。1枚のLinearGradientの
            色だけでは再現できないため、背景を2枚重ねたView(position:
            relative + absoluteFill)にしている。 */}
        <View style={[styles.headerGradientBase, { paddingTop: insets.top + EXTRA_TOP_PADDING }]}>
          <LinearGradient
            colors={[colors.headerAccent, colors.headerPlum]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={[colors.headerShadeTop, colors.headerShadeBottom]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 0.75 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.headerRow}>
            {/* 「✖️は＜に戻して」という指摘を受け、×ボタン(丸背景付き)
                から元の＜(chevron-back、背景なし)に戻した。 */}
            <Pressable onPress={onBack} hitSlop={10} accessibilityLabel={t.group.back}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
            {/* 以前はここ(グループ名部分)をタップするとアイコン変更用の
                モーダルが開いたが、「設定ボタンからアイコンやグループ名を
                変更できるようにした方がいい」という指摘(86回目)を受け、
                アイコン変更もGroupSettingsScreenに一本化した(入り口が
                2つあると分かりにくいため)。そのためタップ不要のただの
                テキストに戻した。 */}
            <View style={styles.titleCol}>
              <Text style={styles.title} numberOfLines={1}>{group.name}</Text>
              <Text style={styles.memberCount}>{t.group.memberCount(members.length)}</Text>
            </View>
            <View style={styles.headerRightRow}>
              <Pressable onPress={onOpenNotifications} hitSlop={10} accessibilityLabel={t.notifications.title} style={styles.bellWrap}>
                <Ionicons name="notifications-outline" size={22} color="#fff" />
                {hasUnreadNotifications && <View style={styles.unreadDot} />}
              </Pressable>
              <Pressable onPress={leave} hitSlop={10} accessibilityLabel={t.group.leave}>
                <Ionicons name="exit-outline" size={22} color="#fff" />
              </Pressable>
              <Pressable onPress={onOpenSettings} hitSlop={10} accessibilityLabel={t.groups.settingsButton}>
                <Ionicons name="settings-outline" size={22} color="#fff" />
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      {/* 画像で示してもらって判明: 動かすべきはアイコンの位置ではなく、
          「下の白い本体側」の形だった。本体側(メンバー行の背景)を
          上端だけ角丸にしたカードにして、ヘッダーの下端に少しだけ
          めり込ませる(marginTopを負にする)。ただし、めり込んだ分は
          paddingTopで打ち消しているため、中のアイコン・名前・バッジの
          位置自体は変わらない(角丸カードの「背景の形」だけが上に
          伸びて、ヘッダーとの継ぎ目を自然に見せている)。 */}
      <View style={styles.memberStripCard}>
        {/* 「メンバーが増えた場合は横スクロールできるようにする」という
            指摘を受け、折り返し(flexWrap)から横スクロール(ScrollView)に
            変更した。人数が少ない間は画面内に収まるため見た目は変わらない。 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.memberStrip}>
          {members.map((m) => {
            const isMe = m.id === meId;
            const isAdmin = m.id === group.created_by;
            const slot = (
              <>
                {/* 参考画像のアイコンには、アイコン自身の色と同系色の
                    細いリング(少し隙間を空けた輪)が付いていたため、
                    アバターの色(avatarColor)をそのまま縁取りに使った
                    リング状のViewで囲んでいる。 */}
                <View style={[styles.avatarRing, { borderColor: avatarColor(m.display_name) }]}>
                  <Avatar name={m.display_name} emoji={m.avatar_emoji} photoPath={m.avatar_photo_path} size="lg" />
                </View>
                <Text style={styles.memberSlotName} numberOfLines={1}>
                  {m.display_name}
                </Text>
                {isAdmin && (
                  <View style={styles.adminBadge}>
                    <Text style={styles.adminBadgeText}>{t.group.adminBadge}</Text>
                  </View>
                )}
              </>
            );
            return isMe ? (
              <Pressable key={m.id} onPress={() => setAvatarPickerOpen(true)} style={styles.memberSlot}>
                {slot}
              </Pressable>
            ) : (
              <View key={m.id} style={styles.memberSlot}>
                {slot}
              </View>
            );
          })}
          {pendingInvites.map((invite) => (
            <View key={invite.id} style={styles.memberSlot}>
              <View style={[styles.avatarCircle, styles.pendingCircle]}>
                <Ionicons name="mail" size={22} color="#fff" />
              </View>
              <Text style={styles.memberSlotName} numberOfLines={1}>
                {invite.invited_name}
              </Text>
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>{t.group.pendingSectionTitle}</Text>
              </View>
            </View>
          ))}
          <Pressable onPress={() => setInviteModalOpen(true)} style={styles.memberSlot}>
            <View style={[styles.avatarCircle, styles.addCircle]}>
              <Ionicons name="add" size={26} color={colors.muted} />
            </View>
            <Text style={styles.memberSlotName}>{t.group.invite}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );

  // 以前はタブごとに3つのreturn文でSectionList・Fab・各種モーダルを
  // まるごと複製していたが、下固定のBottomTabBarを導入するにあたり
  // 「タブに応じて中身(SectionList)だけ切り替え、Fab・モーダル・
  // タブバー自体は1つだけ」という構成に整理した。
  let listContent: ReactElement;
  if (tab === 'balance') {
    listContent = (
      <SectionList
        sections={balanceSections}
        keyExtractor={(row) => `${row.debtor}-${row.creditor}-${row.type}-${row.currency}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            {header}
            <NetSummary totals={netTotals} balances={balances} meId={meId} nameOf={nameOf} emojiOf={emojiOf} />
            {balances.length > 0 && (
              <SettlementProgress
                remaining={settlementProgress.remaining}
                paid={settlementProgress.paid}
                onPress={() => setUnpaidModalOpen(true)}
              />
            )}
            {autoSettlePlans.map((plan) => (
              <AutoSettlePlan
                key={plan.currency}
                groupName={group.name}
                currency={plan.currency}
                transactions={plan.transactions}
                nameOf={nameOf}
                emojiOf={emojiOf}
                meId={meId}
                onSettleAll={() =>
                  settleAllMoney(plan.currency).then((res) => {
                    showEntryErrorIfAny(res);
                    return res;
                  })
                }
              />
            ))}
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        renderItem={({ item }) => (
          <BalanceCard
            row={item}
            nameOf={nameOf}
            emojiOf={emojiOf}
            meId={meId}
            groupId={group.id}
            onSettle={() => settlePair(item.type, item.debtor, item.creditor, item.currency).then(showEntryErrorIfAny)}
            onMarkPaid={() => markPaid(item.debtor, item.creditor, item.currency).then(showEntryErrorIfAny)}
            onConfirmReceived={() => confirmReceived(item.debtor, item.creditor, item.currency).then(showEntryErrorIfAny)}
            onRemindSent={() => logEvent('reminder_sent', { userId: meId, groupId: group.id })}
            onRemindResult={(sent) => setRemindToastMessage(sent ? t.group.remindSentToast : t.group.remindFailedToast)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.hairline} />}
      />
    );
  } else if (tab === 'history') {
    listContent = (
      <SectionList
        sections={historySections}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={<View>{header}</View>}
        renderSectionHeader={({ section }) => <Text style={styles.dateHeader}>{section.title}</Text>}
        renderItem={({ item }) => <HistoryEntryRow entry={item} nameOf={nameOf} meId={meId} />}
        ItemSeparatorComponent={() => <View style={styles.hairline} />}
        ListEmptyComponent={!loading ? <Text style={styles.emptyNote}>{t.history.empty}</Text> : null}
      />
    );
  } else {
    listContent = (
      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            {header}
            {settledCount > 0 && (
              <Pressable onPress={() => setShowSettled((v) => !v)} style={styles.settledToggle}>
                <Text style={styles.settledToggleText}>
                  {showSettled ? t.group.hideSettled : t.group.showSettled(settledCount)}
                </Text>
              </Pressable>
            )}
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={styles.dateHeader}>{section.title}</Text>}
        renderItem={({ item }) => (
          <EntryRow
            entry={item}
            nameOf={nameOf}
            meId={meId}
            onToggleSettled={(e) =>
              toggleSettled(e, e.settle_status === 'confirmed' ? 'unpaid' : 'confirmed').then(showEntryErrorIfAny)
            }
            onUpdate={updateEntry}
            onDelete={(e) => deleteEntry(e).then(showEntryErrorIfAny)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.hairline} />}
        ListEmptyComponent={!loading ? <Text style={styles.emptyNote}>{t.group.emptyLedger}</Text> : null}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      {listContent}
      <Fab
        onPress={() => setSheetOpen(true)}
        disabled={members.length + pendingInvites.length < 2}
        onDisabledPress={() => setFabHintToastVisible(true)}
      />
      <BottomTabBar tab={tab} onChange={setTab} />
      <AddEntrySheet
        visible={sheetOpen}
        members={members}
        pendingInvites={pendingInvites}
        meId={meId}
        onClose={() => setSheetOpen(false)}
        onSubmit={addEntry}
        onSubmitSplit={addSplitEntry}
      />
      {avatarPicker}
      {inviteModal}
      {shareChannelSheet}
      {tab === 'balance' && (
        <UnpaidMembersModal
          visible={unpaidModalOpen}
          rows={receivingRows}
          nameOf={nameOf}
          emojiOf={emojiOf}
          groupId={group.id}
          onConfirmReceived={(row) => confirmReceived(row.debtor, row.creditor, row.currency).then(showEntryErrorIfAny)}
          onRemindSent={() => logEvent('reminder_sent', { userId: meId, groupId: group.id })}
          onRemindResult={(sent) => setRemindToastMessage(sent ? t.group.remindSentToast : t.group.remindFailedToast)}
          onClose={() => setUnpaidModalOpen(false)}
        />
      )}
      <Toast message={remindToastMessage ?? ''} visible={remindToastMessage !== null} onHide={() => setRemindToastMessage(null)} />
      <Toast message={inviteToastMessage ?? ''} visible={inviteToastMessage !== null} onHide={() => setInviteToastMessage(null)} />
      <Toast message={t.group.fabNeedMemberHint} visible={fabHintToastVisible} onHide={() => setFabHintToastVisible(false)} />
      <Toast
        message={entryErrorToastMessage ?? ''}
        visible={entryErrorToastMessage !== null}
        onHide={() => setEntryErrorToastMessage(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: 20, paddingBottom: 100 },
  // 実機で「ふちが逆(上が丸くなっている)・上部が長い」という指摘を受けて
  // 修正: overflow:'hidden'を付けないと、asymmetric(上下非対称)な
  // borderRadiusがLinearGradientで正しく反映されず、角の丸みが意図通り
  // 下だけでなく上にも出てしまうことがある。paddingTopも、以前の
  // headerRow(marginTop:44)で実績のあった値に戻し、必要以上に高く
  // ならないようにした。
  // 「ふちが逆になっている」という指摘を受けて再修正: 画面の端まで
  // 塗り広げて下だけ丸める「バナー」的な扱いをやめ、参考画像の通り
  // 左右にも余白を持たせた「浮いた1枚のカード」として四隅すべてを
  // 丸める形に変更した(残高カード等、他のカードと同じ扱いに揃えた)。
  // ステータスバー避けの余白は、以前はpaddingTop(帯の内側の余白)で
  // 持たせていたが、カード化にともないmarginTop(カードの外側の余白)
  // に変更している。
  // 影(shadow)はoverflow:'hidden'を持つViewには描画されないため、
  // 影を持つ外側のラッパーと、角丸+クリップ用の内側のViewを分けている。
  // 「下部分の角丸を削除し、重なる部分まで自然に伸ばして下のコンテンツと
  // 一体化させる」という指摘への対応。以前は下だけ角丸+影を付けて
  // 「本体の上に浮くカード」に見せていたが、それだと重なり付近に丸みの
  // 切れ込みや不自然な隙間ができてしまっていた。角丸(borderBottomLeft/
  // RightRadius)と影(shadow/elevation)を両方やめ、四角いまま下の
  // メンバー行の直前まで隙間なく伸ばすことで、継ぎ目のない1枚の背景に
  // 見えるようにした。
  headerShadowWrap: {
    marginHorizontal: -20,
    marginBottom: 0,
  },
  // position:'relative'を付けたことで、中の2枚のLinearGradient
  // (StyleSheet.absoluteFill)がこのViewいっぱいに重なり、その上に
  // headerRow(実際のコンテンツ)がpadding付きで乗る。
  // 「大学の友達・通知・設定・◯人のメンバーを上に配置して」という
  // 指摘を受け、paddingTopを44→28に詰めてタイトル行全体を上に
  // 寄せた(下側のmemberStripCardとの重なり方=paddingBottom(16)は
  // そのまま維持)。
  // paddingTopの固定値(28)は「ステータスバーに被る」不具合の原因に
  // なっていたため撤去し、代わりにinsets.top(セーフエリアの実測値)+
  // EXTRA_TOP_PADDINGを呼び出し側でインラインで指定するようにした
  // (styles.headerGradientBaseWithInsetsを参照)。
  headerGradientBase: {
    position: 'relative',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  // 「戻る・通知・設定の余白を統一する」ため、titleColの左右マージンを
  // headerRightRowのgapと同じ16に揃えた。
  headerRightRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  bellWrap: { position: 'relative' },
  unreadDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  titleCol: { flex: 1, marginHorizontal: 16 },
  // 「グループ名をもう少し大きくする」という指摘を受けてfontSizeを上げた。
  title: { ...fonts.display, fontSize: 23, color: '#fff' },
  memberCount: { ...fonts.bodyMedium, fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 1 },
  // メンバー行の「背景」だけを、上端が角丸のカードにしてヘッダーの下端に
  // 少しめり込ませる。marginTopを負にして食い込ませ、paddingTopで
  // 打ち消す仕組み(打ち消し量が同じだと中身の位置は変わらない)。
  // 過去の「まだ被っている」という指摘を受けてpaddingTopを一度26まで
  // 増やしたが、「名前とアイコンを少し上の位置に上げて」という指摘を
  // 受け、26→18に少し戻した(marginTop:-12との差分=正味の下方向の
  // オフセットを14→6に縮め、アイコン・名前を少し上に寄せた)。
  memberStripCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginHorizontal: -20,
    marginTop: -12,
    paddingTop: 18,
    paddingHorizontal: 20,
  },
  // 「あなたの残高の枠も少し上に」という指摘を受け、メンバー行と
  // 残高カードの間隔(marginBottom)を18→10に詰めた。
  memberStrip: { flexDirection: 'row', gap: 16, marginBottom: 10, paddingRight: 4 },
  memberSlot: { alignItems: 'center', width: 70, gap: 4 },
  // lgアバター(44px)の周りに、隙間を空けた同系色のリングを描く
  // (アイコン自体は「大きくするんじゃなくて」の指摘で44に戻したため、
  // リングのサイズもそれに合わせて60→56に調整)。
  avatarRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberSlotName: { ...fonts.bodyMedium, fontSize: 12, color: colors.ink, maxWidth: 68 },
  // 過去に「少し小さくして主張を弱める」という指摘でfontSizeを
  // 落としていたが、「管理者の文字をもう少しだけ大きくして」という
  // 指摘を受け、8.5→9.5に少し戻した。
  adminBadge: { backgroundColor: colors.accentSoft, borderRadius: 999, paddingVertical: 1, paddingHorizontal: 6 },
  adminBadgeText: { ...fonts.bodySemiBold, fontSize: 9.5, color: colors.accent },
  // 「招待するの◯もアイコンと同じ大きさにして」という指摘を受け、
  // 44(アバター本体と同じ)→56(アバター+リングの見た目上の外径と同じ)
  // に拡大した。通常メンバーはリング(avatarRing、56px)込みで見た目の
  // 直径が56pxになるため、それに揃えている。
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 「招待中のユーザーは通常メンバーと見た目を明確に区別する(点線枠＋
  // メールアイコン＋招待中)」という指摘を受け、塗りつぶし円はそのまま
  // 維持しつつ、点線の縁取りを重ねて「まだ確定していない」印象を強めた。
  pendingCircle: {
    backgroundColor: colors.favor,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.7)',
  },
  pendingBadge: { backgroundColor: colors.accentSoft, borderRadius: 999, paddingVertical: 1, paddingHorizontal: 6 },
  pendingBadgeText: { ...fonts.bodySemiBold, fontSize: 8.5, color: colors.accent },
  addCircle: { borderWidth: 1.5, borderColor: colors.muted, borderStyle: 'dashed' },
  sectionTitle: {
    ...fonts.bodySemiBold,
    fontSize: 12.5,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 4,
  },
  dateHeader: {
    ...fonts.bodySemiBold,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 14,
    marginBottom: 2,
  },
  settledToggle: { alignSelf: 'flex-start', marginBottom: 6 },
  settledToggleText: { ...fonts.bodyMedium, fontSize: 13, color: colors.accent },
  hairline: { height: 1, backgroundColor: colors.line },
  emptyNote: { ...fonts.body, fontSize: 14.5, color: colors.muted, textAlign: 'center', paddingVertical: 24 },
});
