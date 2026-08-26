import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import GroupFormModal from '../components/GroupFormModal';
import Mark from '../components/Mark';
import PrimaryButton from '../components/PrimaryButton';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';
import type { Group } from '../types';

type Props = {
  displayName: string;
  groups: Group[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenGroup: (group: Group, justCreated?: boolean) => void;
  onCreateGroup: (name: string, iconEmoji: string | null) => Promise<{ error: string | null; group: Group | null }>;
  onJoinGroup: (code: string) => Promise<{ error: string | null; group: Group | null }>;
  onOpenSettings: () => void;
};

export default function GroupsScreen({
  displayName,
  groups,
  loading,
  onRefresh,
  onOpenGroup,
  onCreateGroup,
  onJoinGroup,
  onOpenSettings,
}: Props) {
  const t = useT();
  const [modal, setModal] = useState<'create' | 'join' | null>(null);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Mark size={34} />
          <Text style={styles.wordmark}>kashikari</Text>
          <Pressable onPress={onOpenSettings} hitSlop={10} style={styles.settingsBtn} accessibilityLabel={t.groups.settingsButton}>
            <Ionicons name="settings-outline" size={22} color={colors.ink} />
          </Pressable>
        </View>
        <Text style={styles.hello}>{t.groups.hello(displayName)}</Text>
      </View>

      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{t.groups.empty}</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => onOpenGroup(item)} style={styles.card}>
            <Mark size={44} glyph={item.icon_emoji ?? undefined} />
            <View style={styles.cardMain}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardCode}>{t.groups.inviteCode(item.invite_code)}</Text>
            </View>
          </Pressable>
        )}
      />

      <View style={styles.actions}>
        <PrimaryButton title={t.groups.joinButton} variant="ghost" onPress={() => setModal('join')} />
        <PrimaryButton title={t.groups.createButton} onPress={() => setModal('create')} />
      </View>

      <GroupFormModal
        visible={modal === 'create'}
        mode="create"
        onClose={() => setModal(null)}
        onSubmit={async (name, iconEmoji) => {
          const res = await onCreateGroup(name, iconEmoji);
          if (res.group) onOpenGroup(res.group, true);
          return { error: res.error };
        }}
      />
      <GroupFormModal
        visible={modal === 'join'}
        mode="join"
        onClose={() => setModal(null)}
        onSubmit={async (code) => {
          const res = await onJoinGroup(code);
          if (res.group) onOpenGroup(res.group);
          return { error: res.error };
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmark: { ...fonts.display, fontSize: 28, color: colors.ink, flex: 1 },
  settingsBtn: { padding: 4 },
  hello: { ...fonts.body, fontSize: 14, color: colors.muted, marginTop: 8 },
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 10, flexGrow: 1 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { ...fonts.body, fontSize: 14.5, color: colors.muted, textAlign: 'center', lineHeight: 22 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#3c2814',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardMain: { flex: 1 },
  cardTitle: { ...fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  cardCode: { ...fonts.body, fontSize: 12.5, color: colors.muted, marginTop: 2 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 28,
    paddingTop: 8,
  },
});
