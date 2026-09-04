import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import Avatar from '../components/Avatar';
import GroupIconPicker from '../components/GroupIconPicker';
import Mark from '../components/Mark';
import PrimaryButton from '../components/PrimaryButton';
import ShareChannelSheet from '../components/ShareChannelSheet';
import { useT } from '../i18n';
import { buildEntriesCsv } from '../lib/exportCsv';
import { buildInviteUrl } from '../lib/invite';
import { usePremiumContext } from '../lib/premiumContext';
import { colors, fonts } from '../theme';
import type { Entry, Group, Profile } from '../types';

// 「グループ内の設定ボタンを押したら、グループの設定(アイコンやグループ名
// など)を変更できるようにした方がいい」という指摘への対応(87回目)。
// 以前はグループ詳細画面の歯車アイコンから個人設定(SettingsScreen、
// 言語・自分のアイコン・ログイン方法・ログアウトなど)を開いていたが、
// 今どのグループを見ているかに関係のない個人設定がここに出るのは
// 分かりにくいという指摘を受け、この専用画面(アイコン・グループ名のみ)
// に差し替えた。個人設定はホーム画面の歯車から引き続き開ける。
//
// グループアイコンの変更自体は以前、グループ詳細画面のヘッダーで
// グループ名をタップすると開く形になっていたが、この画面に一本化する
// ため撤去した(入り口が2つあると分かりにくいため)。
//
// 89回目で「アイコンとグループ名だけじゃ寂しい」という指摘を受け、
// 招待コードの共有・通知ミュート・メンバー削除(管理者のみ)・
// グループ削除(管理者のみ)を追加した。
type Props = {
  group: Group;
  members: Profile[];
  meId: string | null;
  onBack: () => void;
  onChangeName: (name: string) => Promise<{ error: string | null }>;
  onChangeIcon: (emoji: string) => Promise<{ error: string | null }>;
  // デモモードでは実際のアップロードができないため渡されない
  // (渡されない場合はGroupIconPicker側で「写真から選ぶ」ボタン自体を出さない)。
  onChangeIconPhoto?: (uri: string) => Promise<{ error: string | null }>;
  isMuted: boolean;
  onToggleMute: (muted: boolean) => Promise<{ error: string | null }>;
  onRemoveMember: (userId: string) => Promise<{ error: string | null }>;
  onDeleteGroup: () => Promise<{ error: string | null }>;
  // CSV出力(94回目、Premium特典)。このグループの記録一覧そのもの
  // (useGroupDataが持っている全件)が必要なので、GroupScreen側から
  // そのまま渡してもらう。
  entries: Entry[];
  onOpenPremium: () => void;
};

export default function GroupSettingsScreen({
  group,
  members,
  meId,
  onBack,
  onChangeName,
  onChangeIcon,
  onChangeIconPhoto,
  isMuted,
  onToggleMute,
  onRemoveMember,
  onDeleteGroup,
  entries,
  onOpenPremium,
}: Props) {
  const t = useT();
  const { isPremium } = usePremiumContext();
  const [name, setName] = useState(group.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [mutedToggling, setMutedToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = meId != null && meId === group.created_by;
  const nameDirty = name.trim() !== group.name && name.trim().length > 0;

  const saveName = async () => {
    setSaving(true);
    setSavedNote(false);
    const res = await onChangeName(name);
    setSaving(false);
    if (res.error) {
      setNameError(res.error);
      return;
    }
    setNameError(null);
    setSavedNote(true);
  };

  // CSV出力(94回目)。無課金ユーザーが押した場合は実際にはエクスポート
  // せず、Premium画面へ誘導する(「広告なし」と同じく、機能自体は
  // 見えているが実行はPremium加入後、という出し分け方にした)。
  const nameOfForExport = (id: string) => members.find((m) => m.id === id)?.display_name ?? t.group.unknownMember;
  const exportCsv = async () => {
    if (!isPremium) {
      onOpenPremium();
      return;
    }
    const csv = buildEntriesCsv(entries, nameOfForExport);
    try {
      await Share.share({ message: csv });
    } catch {
      // 共有シート自体のキャンセル・失敗は握りつぶす(他の共有機能と同じ方針)。
    }
  };

  const toggleMute = async (value: boolean) => {
    setMutedToggling(true);
    const res = await onToggleMute(value);
    setMutedToggling(false);
    if (res.error) Alert.alert(t.groupSettings.muteFailedTitle, res.error);
  };

  const confirmRemoveMember = (member: Profile) => {
    Alert.alert(t.groupSettings.removeMemberConfirmTitle(member.display_name), t.groupSettings.removeMemberConfirmMessage, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.groupSettings.removeMemberConfirmButton,
        style: 'destructive',
        onPress: async () => {
          const res = await onRemoveMember(member.id);
          if (res.error) Alert.alert(t.groupSettings.removeMemberFailedTitle, res.error);
        },
      },
    ]);
  };

  const confirmDeleteGroup = () => {
    Alert.alert(t.groupSettings.deleteGroupConfirmTitle(group.name), t.groupSettings.deleteGroupConfirmMessage, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.groupSettings.deleteGroupConfirmButton,
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          const res = await onDeleteGroup();
          setDeleting(false);
          if (res.error) Alert.alert(t.groupSettings.deleteGroupFailedTitle, res.error);
        },
      },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityLabel={t.groupSettings.back}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
        </View>
        <Text style={styles.title}>{t.groupSettings.title}</Text>

        <Text style={styles.sectionLabel}>{t.groupSettings.icon}</Text>
        <Pressable onPress={() => setIconPickerOpen(true)} style={styles.row}>
          <Mark size={48} glyph={group.icon_emoji ?? undefined} photoPath={group.icon_photo_path} />
          <Text style={styles.rowText}>{t.groupForm.changeIcon}</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>{t.groupSettings.name}</Text>
        <TextInput
          value={name}
          onChangeText={(v) => {
            setName(v);
            setNameError(null);
            setSavedNote(false);
          }}
          placeholder={t.groupSettings.namePlaceholder}
          placeholderTextColor={colors.muted}
          maxLength={30}
          style={styles.input}
        />
        {nameError && <Text style={styles.error}>{nameError}</Text>}
        {savedNote && !nameError && <Text style={styles.savedNote}>{t.groupSettings.savedNote}</Text>}
        <PrimaryButton title={t.common.save} onPress={saveName} loading={saving} disabled={!nameDirty} style={styles.saveButton} />

        <Text style={styles.sectionLabel}>{t.groupSettings.inviteLabel}</Text>
        <View style={styles.inviteRow}>
          <Text style={styles.inviteCode}>{group.invite_code}</Text>
          <PrimaryButton
            title={t.groupSettings.inviteShareButton}
            variant="secondary"
            compact
            onPress={() => setShareSheetOpen(true)}
          />
        </View>

        <Text style={styles.sectionLabel}>{t.notifications.title}</Text>
        <View style={styles.muteRow}>
          <View style={styles.muteTextCol}>
            <Text style={styles.rowText}>{t.groupSettings.muteLabel}</Text>
            <Text style={styles.muteDescription}>{t.groupSettings.muteDescription}</Text>
          </View>
          <Switch
            value={isMuted}
            onValueChange={toggleMute}
            disabled={mutedToggling}
            trackColor={{ true: colors.accent, false: colors.line }}
          />
        </View>

        <Text style={styles.sectionLabel}>{t.groupSettings.membersLabel}</Text>
        <View style={styles.membersCard}>
          {members.map((member, i) => {
            const memberIsAdmin = member.id === group.created_by;
            return (
              <View key={member.id} style={[styles.memberRow, i > 0 && styles.memberRowBorder]}>
                <Avatar name={member.display_name} emoji={member.avatar_emoji} photoPath={member.avatar_photo_path} size="sm" />
                <Text style={styles.memberName} numberOfLines={1}>
                  {member.display_name}
                </Text>
                {memberIsAdmin && (
                  <View style={styles.adminBadge}>
                    <Text style={styles.adminBadgeText}>{t.group.adminBadge}</Text>
                  </View>
                )}
                {isAdmin && !memberIsAdmin && (
                  <Pressable onPress={() => confirmRemoveMember(member)} hitSlop={10} accessibilityLabel={t.groupSettings.removeMemberConfirmButton}>
                    <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>{t.groupSettings.dataLabel}</Text>
        <Pressable onPress={exportCsv} style={styles.row}>
          <Ionicons name="download-outline" size={20} color={colors.ink} />
          <Text style={styles.rowText}>{t.groupSettings.exportCsvButton}</Text>
          {!isPremium && (
            <View style={styles.premiumBadge}>
              <Text style={styles.premiumBadgeText}>{t.groupSettings.premiumBadge}</Text>
            </View>
          )}
        </Pressable>

        {isAdmin && (
          <>
            <Text style={styles.sectionLabel}>{t.groupSettings.dangerZoneLabel}</Text>
            <Pressable onPress={confirmDeleteGroup} disabled={deleting} style={styles.deleteButton}>
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={styles.deleteButtonText}>{t.groupSettings.deleteGroupButton}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <GroupIconPicker
        visible={iconPickerOpen}
        selected={group.icon_emoji}
        onSelect={async (emoji) => {
          setIconPickerOpen(false);
          await onChangeIcon(emoji);
        }}
        onSelectPhoto={
          onChangeIconPhoto &&
          (async (uri) => {
            setIconPickerOpen(false);
            await onChangeIconPhoto(uri);
          })
        }
        onClose={() => setIconPickerOpen(false)}
      />

      <ShareChannelSheet
        visible={shareSheetOpen}
        message={t.group.inviteMessage(group.name, buildInviteUrl(group.invite_code), group.invite_code)}
        onClose={() => setShareSheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  headerRow: { marginBottom: 4 },
  title: { ...fonts.display, fontSize: 26, color: colors.ink, marginTop: 4, marginBottom: 20 },
  sectionLabel: {
    ...fonts.bodySemiBold,
    fontSize: 12.5,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 24,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  rowText: { ...fonts.bodyMedium, fontSize: 14, color: colors.ink, flexShrink: 1 },
  premiumBadge: { marginLeft: 'auto', backgroundColor: colors.plum + '1a', borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
  premiumBadgeText: { ...fonts.bodySemiBold, fontSize: 10.5, color: colors.plum },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  error: { color: colors.danger, ...fonts.body, fontSize: 13, marginTop: 8 },
  savedNote: { color: colors.positive, ...fonts.body, fontSize: 13, marginTop: 8 },
  saveButton: { marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 28 },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  inviteCode: { ...fonts.display, fontSize: 18, color: colors.ink, letterSpacing: 1 },
  muteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  muteTextCol: { flex: 1, gap: 3 },
  muteDescription: { ...fonts.body, fontSize: 12.5, color: colors.muted, lineHeight: 17 },
  membersCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.line,
    paddingHorizontal: 16,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  memberRowBorder: { borderTopWidth: 1, borderTopColor: colors.line },
  memberName: { ...fonts.bodyMedium, fontSize: 14.5, color: colors.ink, flex: 1 },
  adminBadge: { backgroundColor: colors.accentSoft, borderRadius: 999, paddingVertical: 1, paddingHorizontal: 6 },
  adminBadgeText: { ...fonts.bodySemiBold, fontSize: 9.5, color: colors.accent },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.danger + '40',
  },
  deleteButtonText: { ...fonts.bodySemiBold, fontSize: 15, color: colors.danger },
});
