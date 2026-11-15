import * as Sharing from 'expo-sharing';
import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { captureRef } from 'react-native-view-shot';

import { AppText, BottomSheet, Button, Chip, showToast } from '../../theme/components';
import { FONTS, SPACING } from '../../theme/typography';
import { quoteLocation } from './quoteFormat';
import type { QuoteView } from './quotesRepository';

interface ImageStyle {
  id: 'paper' | 'night' | 'ink' | 'frame';
  background: string;
  text: string;
  accent: string;
  serif: boolean;
  /** Decoration: a big quotation mark, a bar on the left, or a thin frame. */
  mark: 'quote' | 'bar' | 'frame';
}

/** Fixed colours: the image must look the same whatever the theme of the app. */
export const QUOTE_IMAGE_STYLES: ImageStyle[] = [
  {
    id: 'paper',
    background: '#F6EFE0',
    text: '#2B2620',
    accent: '#8A5A2B',
    serif: true,
    mark: 'quote',
  },
  {
    id: 'night',
    background: '#12141C',
    text: '#ECEEF6',
    accent: '#9CB4FF',
    serif: false,
    mark: 'bar',
  },
  {
    id: 'ink',
    background: '#263A8C',
    text: '#FFFFFF',
    accent: '#C9D4FF',
    serif: true,
    mark: 'quote',
  },
  {
    id: 'frame',
    background: '#FFFFFF',
    text: '#1B1C20',
    accent: '#3F4A9A',
    serif: false,
    mark: 'frame',
  },
];

/** Smaller text for long quotes, so that the image keeps a pleasant shape. */
function textSize(length: number): number {
  if (length < 120) {
    return 22;
  }
  if (length < 320) {
    return 18;
  }
  return length < 700 ? 15 : 13;
}

/** "Share as an image": a card with the quote, its novel and chapter, in four styles. */
export function QuoteImageSheet({
  quote,
  onClose,
}: {
  quote: QuoteView | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const card = useRef<ComponentRef<typeof View>>(null);
  const [styleId, setStyleId] = useState<ImageStyle['id']>('paper');
  const [busy, setBusy] = useState(false);
  const look = QUOTE_IMAGE_STYLES.find((item) => item.id === styleId) ?? QUOTE_IMAGE_STYLES[0];

  const share = () => {
    setBusy(true);
    captureRef(card, { format: 'png', quality: 1, result: 'tmpfile' })
      .then((uri) =>
        Sharing.shareAsync(uri.startsWith('file://') ? uri : `file://${uri}`, {
          mimeType: 'image/png',
        }),
      )
      .then(onClose)
      .catch(() => showToast(t('quotes.imageFailed')))
      .finally(() => setBusy(false));
  };

  const size = quote ? textSize(quote.text.length) : 18;
  const family = look.serif ? 'serif' : FONTS.regular;

  return (
    <BottomSheet visible={quote !== null} onClose={onClose} title={t('quotes.shareImage')}>
      {quote ? (
        <View style={styles.content}>
          <View
            ref={card}
            collapsable={false}
            style={[
              styles.card,
              { backgroundColor: look.background },
              look.mark === 'frame' && { borderWidth: 2, borderColor: look.accent },
            ]}
          >
            {look.mark === 'quote' ? (
              <AppText style={[styles.mark, { color: look.accent }]} allowFontScaling={false}>
                “
              </AppText>
            ) : null}
            <View style={look.mark === 'bar' && [styles.bar, { borderLeftColor: look.accent }]}>
              <AppText
                allowFontScaling={false}
                style={{
                  color: look.text,
                  fontFamily: family,
                  fontSize: size,
                  lineHeight: Math.round(size * 1.5),
                }}
              >
                {quote.text}
              </AppText>
            </View>
            <View style={styles.source}>
              <AppText
                allowFontScaling={false}
                style={[styles.novel, { color: look.text }]}
                numberOfLines={2}
              >
                {quote.novelTitle}
              </AppText>
              <AppText
                allowFontScaling={false}
                style={[styles.chapter, { color: look.accent }]}
                numberOfLines={2}
              >
                {quoteLocation(quote, t)}
              </AppText>
            </View>
          </View>

          <View style={styles.chips}>
            {QUOTE_IMAGE_STYLES.map((item) => (
              <Chip
                key={item.id}
                label={t(`quotes.imageStyle.${item.id}`)}
                selected={item.id === styleId}
                onPress={() => setStyleId(item.id)}
              />
            ))}
          </View>
          <Button
            icon="share-variant-outline"
            label={t('quotes.shareImage')}
            disabled={busy}
            onPress={share}
          />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, gap: SPACING.md },
  card: { padding: 28, gap: 18 },
  mark: { fontFamily: 'serif', fontSize: 64, lineHeight: 64, height: 40 },
  bar: { borderLeftWidth: 4, paddingLeft: 14 },
  source: { gap: 2 },
  novel: { fontFamily: FONTS.semiBold, fontSize: 14, lineHeight: 19 },
  chapter: { fontFamily: FONTS.regular, fontSize: 12, lineHeight: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
});
