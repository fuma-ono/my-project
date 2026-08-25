import { StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { colors, fonts } from '../theme';
import type { GroupInvite } from '../types';

type Props = { invites: GroupInvite[] };

// 「招待中(まだ参加していない)」だけを、メンバー一覧の下に小さく出す。
// 参加済みのメンバーは既にmemberStrip側に✅相当の形(アバター+名前)で
// 出ているため、ここでは重複させず「招待中」だけを担当する。
// 1件も無ければ何も描画しない(招待していないグループでは常に空)。
export default function PendingInvites({ invites }: Props) {
  const t = useT();
  const pending = invites.filter((i) => i.status === 'pending');
  if (pending.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t.group.pendingSectionTitle}</Text>
      <View style={styles.row}>
        {pending.map((invite) => (
          <View key={invite.id} style={styles.chip}>
            <Text style={styles.icon}>📨</Text>
            <Text style={styles.name}>{invite.invited_name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: -8, marginBottom: 18 },
  label: { ...fonts.bodyMedium, fontSize: 12, color: colors.muted, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  icon: { fontSize: 12 },
  name: { ...fonts.bodyMedium, fontSize: 12.5, color: colors.muted },
});
