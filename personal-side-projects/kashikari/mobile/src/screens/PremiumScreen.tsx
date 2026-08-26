import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import Toast from '../components/Toast';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

type Props = {
  onBack: () => void;
  // 実際の計測(analytics_events)は呼び出し側(App.tsx / DemoApp.tsx)に
  // 任せる。デモモードでは何もしない関数を渡してもらう想定。
  onView: () => void;
  onInterest: () => void;
};

// 決済はまだ実装しない。「本当にお金を払いたい人がいるか」を、課金機能を
// 作り込む前に確かめるための紹介ページ(閲覧数と「興味がある」率を計測する)。
export default function PremiumScreen({ onBack, onView, onInterest }: Props) {
  const t = useT();
  const [interested, setInterested] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    onView();
  }, []);

  const pressInterest = () => {
    if (interested) return;
    setInterested(true);
    setToastVisible(true);
    onInterest();
  };

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          {/* グループ画面の「‹」アイコンに揃え、テキストの矢印から
              Ionicons(chevron-back)に統一した。 */}
          <Pressable onPress={onBack} hitSlop={10} accessibilityLabel={t.premium.back}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
        </View>
        <Text style={styles.title}>{t.premium.title}</Text>
        <Text style={styles.price}>{t.premium.price}</Text>

        <Text style={styles.sectionLabel}>{t.premium.featuresTitle}</Text>
        <View style={styles.featureList}>
          {t.premium.features.map((feature) => (
            <View key={feature} style={styles.featureRow}>
              <Text style={styles.featureCheck}>✓</Text>
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        <View style={styles.comingSoonBadge}>
          <Text style={styles.comingSoonText}>{t.premium.comingSoon}</Text>
        </View>

        {interested ? (
          <Text style={styles.interestedNote}>{t.premium.interestedNote}</Text>
        ) : (
          <PrimaryButton title={t.premium.interestButton} onPress={pressInterest} style={styles.interestButton} />
        )}
      </ScrollView>

      <Toast message={t.premium.toastMessage} visible={toastVisible} onHide={() => setToastVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  headerRow: { marginBottom: 4 },
  title: { ...fonts.display, fontSize: 26, color: colors.ink, marginTop: 4, marginBottom: 4 },
  price: { ...fonts.bodySemiBold, fontSize: 15, color: colors.plum, marginBottom: 24 },
  sectionLabel: {
    ...fonts.bodySemiBold,
    fontSize: 12.5,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  featureList: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureCheck: { ...fonts.bodySemiBold, fontSize: 14, color: colors.positive },
  featureText: { ...fonts.bodyMedium, fontSize: 14.5, color: colors.ink },
  comingSoonBadge: {
    marginTop: 20,
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  comingSoonText: { ...fonts.body, fontSize: 13, color: colors.muted, lineHeight: 19 },
  interestButton: { marginTop: 24, alignSelf: 'flex-start', paddingHorizontal: 28 },
  interestedNote: { ...fonts.bodyMedium, fontSize: 14, color: colors.positive, marginTop: 24 },
});
