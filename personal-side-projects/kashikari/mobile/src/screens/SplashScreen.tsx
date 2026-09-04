import { StyleSheet, Text, View } from 'react-native';

import Mark from '../components/Mark';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

// 起動直後に一瞬だけ見せるブランド画面。参考UI画像に合わせて、背景に
// 淡いグラデーションのぼかし玉(装飾)・キャッチコピーを追加した。
// 以前は下部にページインジケータ(ドット)も置いていたが、実際に
// スワイプできるカルーセルではない静的な装飾で意味を持たないため、
// 「いらなくない?」という指摘を受けて削除した。
//
// この画面はApp.tsx側で「カスタムフォント(M PLUS Rounded 1c)の読み込みが
// 終わるまで」表示され続ける("最初のページだけkashikariの字体が違う"という
// 指摘への対応)。つまりfontsLoadedがfalseの間、まさにこの画面自身が表示
// されている真っ最中であり、その間はwordmark/taglineのfontFamilyが未登録
// でOSの標準フォントにフォールバックしてしまう。読み込みが遅い端末・
// 初回起動では最小表示時間(900ms)いっぱいこの状態のまま切り替わって
// しまうこともあるため、fontsReadyがtrueになるまでは文字を透明にして
// 見せないようにし、正しいフォントで描画できるようになってから表示する。
//
// 【追記】上記の対応(opacityの切り替え)だけでは実機で直りきらなかった
// (設定画面のkashikariは崩れないのに、この画面のwordmarkだけ崩れる、
// という切り分けで判明)。原因は、Textのfontsが未登録のうちに一度
// マウントされてしまうと、iOS側がその時点で標準フォントへの描画を
// ネイティブ層で確定させてしまい、後からfontsReady(=opacity)だけを
// 切り替えても、fontFamilyの文字列自体はマウント時からずっと同じ
// (見た目上は変化なし)なため、Reactの差分検出的には「再描画が必要な
// 変更」と認識されず、確定済みの(誤った)ネイティブ描画がopacityで
// 表示されるだけになっていたため。fontsReadyが切り替わるタイミングで
// key propを変えてこのView自体を強制的にアンマウント→再マウントさせる
// ことで、フォントが確実に登録済みの状態から新規にTextを生成させる。
export default function SplashScreen({ fontsReady = true }: { fontsReady?: boolean }) {
  const t = useT();
  return (
    <View style={styles.wrap}>
      <View style={[styles.blob, styles.blobTopLeft]} />
      <View style={[styles.blob, styles.blobTopRight]} />
      <View style={[styles.blob, styles.blobBottom]} />

      <View style={styles.content}>
        <Mark size={112} />
        {/* 「kashikariの文字がアイコンに対して左にずれている」という
            指摘への対応(実測で約73px、画面幅の約6%のズレを確認)。
            このView自体にalignItems:'center'が抜けていたため、既定値
            (stretch)で子のTextが親の幅いっぱいに広がり、2行のtagline
            (幅が広い)に対して1行のwordmarkが左寄せのまま埋もれていた。
            明示的にcenterを指定し、念のためwordmark自体にもtextAlignを
            付けて二重に保険をかける。 */}
        <View key={fontsReady ? 'ready' : 'loading'} style={[styles.fontsWrap, { opacity: fontsReady ? 1 : 0 }]}>
          <Text style={styles.wordmark}>kashikari</Text>
          <Text style={styles.tagline}>{t.splash.tagline}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, overflow: 'hidden' },
  blob: { position: 'absolute', borderRadius: 999 },
  blobTopLeft: { width: 260, height: 260, top: -60, left: -80, backgroundColor: colors.accentSoft, opacity: 0.7 },
  blobTopRight: { width: 220, height: 220, top: -40, right: -70, backgroundColor: colors.favorSoft, opacity: 0.6 },
  blobBottom: { width: 300, height: 300, bottom: -100, left: -60, backgroundColor: colors.accentSoft, opacity: 0.5 },
  content: { alignItems: 'center', gap: 20 },
  fontsWrap: { alignItems: 'center' },
  wordmark: { ...fonts.display, fontSize: 44, color: colors.ink, letterSpacing: -0.5, textAlign: 'center' },
  tagline: { ...fonts.bodyMedium, fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22 },
});
