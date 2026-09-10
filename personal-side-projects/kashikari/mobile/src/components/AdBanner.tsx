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
      <BannerAd
        unitId={BANNER_AD_UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        // 本番の広告ユニットIDに切り替えた直後、審査中で広告が出ない/
        // 設定ミスで出ないのかを実機のMetroログから判別できるように
        // する一時的な計測(101回目)。原因が判明したら消してよい。
        onAdFailedToLoad={(error) => console.warn('[AdBanner] failed to load:', error)}
        onAdLoaded={() => console.log('[AdBanner] loaded')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
});
