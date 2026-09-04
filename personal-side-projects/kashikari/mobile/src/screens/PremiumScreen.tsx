import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import { useT } from '../i18n';
import { usePremiumContext } from '../lib/premiumContext';
import { colors, fonts } from '../theme';

type Props = {
  onBack: () => void;
  // 実際の計測(analytics_events)は呼び出し側(App.tsx / DemoApp.tsx)に
  // 任せる。デモモードでは何もしない関数を渡してもらう想定。
  onView: () => void;
  onPurchased: () => void;
};

// 94回目: 「本当にお金を払いたい人がいるか」を確かめるだけの興味計測
// ページ(20回目)から、RevenueCat経由の実際の購入フローに作り替えた。
// isPremium・購入処理・復元処理はすべてPremiumProvider(usePremium)
// 経由で取得する(App.tsx/DemoApp.tsxのルートで配線済み)。
export default function PremiumScreen({ onBack, onView, onPurchased }: Props) {
  const t = useT();
  const { isPremium, loading, offering, purchase, restore } = usePremiumContext();
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    onView();
  }, []);

  const priceLabel = offering?.availablePackages[0]?.product.priceString ?? t.premium.price;

  const pressSubscribe = async () => {
    setPurchasing(true);
    const res = await purchase();
    setPurchasing(false);
    if (res.cancelled) return;
    if (res.error) {
      Alert.alert(t.premium.purchaseErrorTitle, res.error);
      return;
    }
    onPurchased();
  };

  const pressRestore = async () => {
    setRestoring(true);
    const res = await restore();
    setRestoring(false);
    if (res.error) {
      Alert.alert(t.premium.restoreErrorTitle, res.error);
      return;
    }
    if (res.isPremium) {
      Alert.alert(t.premium.restoreSuccessTitle, t.premium.restoreSuccessMessage);
    } else {
      Alert.alert(t.premium.restoreNotFoundTitle, t.premium.restoreNotFoundMessage);
    }
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
        <Text style={styles.price}>{priceLabel}</Text>

        <Text style={styles.sectionLabel}>{t.premium.featuresTitle}</Text>
        <View style={styles.featureList}>
          {t.premium.features.map((feature) => (
            <View key={feature} style={styles.featureRow}>
              <Text style={styles.featureCheck}>✓</Text>
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator style={styles.loading} color={colors.plum} />
        ) : isPremium ? (
          <Text style={styles.alreadySubscribedNote}>{t.premium.alreadySubscribedNote}</Text>
        ) : (
          <>
            <PrimaryButton
              title={t.premium.subscribeButton}
              onPress={pressSubscribe}
              loading={purchasing}
              style={styles.subscribeButton}
            />
            <Pressable onPress={pressRestore} disabled={restoring} style={styles.restoreRow}>
              <Text style={styles.restoreText}>{restoring ? t.premium.restoringNote : t.premium.restoreButton}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
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
  loading: { marginTop: 28 },
  subscribeButton: { marginTop: 24, alignSelf: 'flex-start', paddingHorizontal: 28 },
  restoreRow: { marginTop: 16, alignSelf: 'flex-start' },
  restoreText: { ...fonts.bodyMedium, fontSize: 13.5, color: colors.muted, textDecorationLine: 'underline' },
  alreadySubscribedNote: { ...fonts.bodyMedium, fontSize: 14, color: colors.positive, marginTop: 24 },
});
