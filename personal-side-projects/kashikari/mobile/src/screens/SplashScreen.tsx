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
// 指摘への対応)。
//
// 【試行錯誤の記録】この「フォント読み込み前にwordmark/taglineが崩れて
// 見える」問題は、これまで2段階の対処を重ねてきたが、どちらも実機では
// 直りきらなかった:
//   1. 最初はTextを常にマウントしたまま、fontsReadyでopacityだけ0↔1に
//      切り替える方式にしたが、フォント未登録の状態で一度マウントされた
//      Textはネイティブ層でその時点のフォントでの描画を確定してしまい、
//      後からopacityを1にしても確定済みの(誤った)描画がそのまま
//      見えるだけだった。
//   2. 次にfontsReadyの値をkey propに使い、値が変わった瞬間にView自体を
//      強制的にアンマウント→再マウントする方式に変えたが、今度は
//      「kashikariの最後の文字が欠ける」「キャッチコピーの2行目が
//      まるごと消える」という、位置・幅の計算そのものが崩れる不具合が
//      新たに出た。App.tsx側でfontsLoaded後に短い遅延を挟んでも直らず、
//      根本的にこの「一度マウントしたものを後から作り直す」アプローチ
//      自体に無理があったと判断した。
//
// 現在の対応: wordmark/taglineをまとめて条件付きレンダリングにし、
// fontsReadyがtrueになるまではこのブロック自体を一切マウントしない
// ようにした。Textが生成される瞬間は必ずfontsReadyがtrueになった後の
// 1回だけなので、上記のような「フォント未登録の状態での描画・計測が
// 後から尾を引く」類の不具合が原理的に起こり得ない、最もシンプルで
// 確実な方法。代わりに、フォントの読み込みが遅い端末では文字が現れる
// 瞬間にMarkのアイコンがわずかに位置調整される(contentのgapの分だけ
// 上下にずれる)可能性があるが、これは実害の少ない一瞬の見た目の話で
// あり、崩れた/欠けた文字が表示され続けるより明らかに良い。
export default function SplashScreen({ fontsReady = true }: { fontsReady?: boolean }) {
  const t = useT();
  return (
    <View style={styles.wrap}>
      <View style={[styles.blob, styles.blobTopLeft]} />
      <View style={[styles.blob, styles.blobTopRight]} />
      <View style={[styles.blob, styles.blobBottom]} />

      <View style={styles.content}>
        <Mark size={112} />
        {fontsReady && (
          // 「kashikariの文字がアイコンに対して左にずれている」という
          // 指摘への対応(実測で約73px、画面幅の約6%のズレを確認)。
          // このView自体にalignItems:'center'が抜けていたため、既定値
          // (stretch)で子のTextが親の幅いっぱいに広がり、2行のtagline
          // (幅が広い)に対して1行のwordmarkが左寄せのまま埋もれていた。
          // 明示的にcenterを指定し、念のためwordmark自体にもtextAlignを
          // 付けて二重に保険をかける。
          <View style={styles.fontsWrap}>
            <Text style={styles.wordmark}>kashikari</Text>
            <Text style={styles.tagline}>{t.splash.tagline}</Text>
          </View>
        )}
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
