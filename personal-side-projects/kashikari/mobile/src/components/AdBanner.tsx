import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';

import { usePremiumContext } from '../lib/premiumContext';
import { BANNER_AD_UNIT_ID, initAds } from '../lib/ads';

// 「広告なし」をPremium特典にする(95回目)。isPremiumのユーザーには
// このコンポーネント自体を何もレンダリングしない(広告リクエスト自体を
// 送らない)。それ以外のユーザーには、画面の下部などに置く前提の
// 適応バナー広告を1枚だけ出す。
export default function AdBanner() {
  const { isPremium } = usePremiumContext();

  useEffect(() => {
    if (!isPremium) initAds();
  }, [isPremium]);

  if (isPremium) return null;

  return (
    <View style={styles.wrap}>
      <BannerAd unitId={BANNER_AD_UNIT_ID} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
});
