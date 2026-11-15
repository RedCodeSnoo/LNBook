import Slider from '@react-native-community/slider';
import { useBatteryLevel } from 'expo-battery';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Pressable, Share, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { RootScreenProps } from '../../app/navigation';
import { useBackHandler } from '../../app/useBackHandler';
import { getDb } from '../../db/client';
import { invalidate, useDataVersion, useQuery } from '../../db/invalidation';
import type { Chapter } from '../../db/schema';
import { deviceFiles } from '../../services/deviceFileStore';
import { novelCssFile, novelDir } from '../../services/fileStore';
import { formatPercent, formatTime } from '../../services/format';
import {
  AppBar,
  AppText,
  Button,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  Menu,
  Screen,
  Skeleton,
  showToast,
} from '../../theme/components';
import { relativeLuminance } from '../../theme/contrast';
import { useTheme } from '../../theme/ThemeProvider';
import { FONTS, SPACING } from '../../theme/typography';
import { setChapterFavorite } from '../novel/novelRepository';
import { QuoteEditorSheet, type QuoteDraft } from '../quotes/QuoteEditorSheet';
import { listChapterQuoteAnchors, listQuotes } from '../quotes/quotesRepository';
import { setSetting, useSetting } from '../settings/settingsStore';
import { useReadingSession } from '../stats/useReadingSession';
import { TtsBar } from '../tts/TtsBar';
import { readAloudFromPlace, startReadingAloud, stopReadingAloud, useTts } from '../tts/ttsService';
import { defaultTargetLang, languageInfo } from '../translation/languages';
import {
  activeTranslationLang,
  getTranslation,
  readDisplayedChapter,
  setReadingLang,
} from '../translation/translationRepository';
import { toTranslationError, type TranslationError } from '../translation/translationRunner';
import {
  downloadModel,
  missingModels,
  switchToOnDeviceEngine,
  translateAhead,
  translateNow,
  translateText,
} from '../translation/translationService';
import { SourceErrorView } from '../browse/SourceBits';
import { preloadChapter, sourcePageUrl, useChapterFetch } from '../browse/useSourceNovel';
import { parseChapterBlocks, serializeNodes } from './blocks';
import { BookSearchSheet } from './BookSearchSheet';
import { ChapterDrawer } from './ChapterDrawer';
import {
  buildReaderDocument,
  parseAnchor,
  settingsCommand,
  type Anchor,
  type ReaderInsets,
} from './readerHtml';
import {
  listReplacementRules,
  loadReaderContext,
  prepareChapterHtml,
  saveReadingPosition,
  touchLastRead,
} from './readerRepository';
import { findTheme } from './readerSettings';
import { ReaderSettingsSheet } from './ReaderSettingsSheet';
import { useReaderDevice } from './useReaderDevice';
import { useReaderSettings } from './useReaderSettings';

// The type parameter of WebView defaults to `undefined`, which TypeScript cannot use.
type NoExtraProps = Record<never, never>;

/** Fonts copied into the Android assets by plugins/withReaderFonts.js. */
const FONTS_URI = 'file:///android_asset/reader-fonts';

type Panel = 'none' | 'settings' | 'chapters' | 'bookSearch' | 'quote';

type RuntimeMessage =
  | { type: 'ready'; blocks: number }
  | { type: 'progress'; progress: number; page: number; pages: number }
  | { type: 'position'; progress: number; anchor: Anchor | null }
  | { type: 'selection'; text: string; anchor?: Anchor | null }
  | { type: 'search'; count: number; index: number }
  | { type: 'autoScroll'; running: boolean }
  | { type: 'link'; href: string }
  | { type: 'tap' | 'next' | 'previous' | 'activity' }
  | { type: 'quoteTap'; id: number };

export function ReaderScreen({ navigation, route }: RootScreenProps<'reader'>) {
  const { chapterId, anchor: anchorParam } = route.params;
  const { t, i18n } = useTranslation();
  const appTheme = useTheme();
  const safeInsets = useSafeAreaInsets();
  const webView = useRef<WebView<NoExtraProps>>(null);

  const context = useQuery(
    () => loadReaderContext(getDb(), chapterId),
    ['chapters', 'novel'],
    [chapterId],
  );
  const novel = context?.novel ?? null;
  const chapter = context?.chapter ?? null;
  const novelId = novel?.id ?? null;
  const { settings, perNovel, update, setPerNovel } = useReaderSettings(novel);
  const contentVersion = useDataVersion('chapterContent');
  const rules = useQuery(() => listReplacementRules(getDb(), novelId), ['replacements'], [novelId]);

  const [barsVisible, setBarsVisible] = useState(false);
  const [panel, setPanel] = useState<Panel>('none');
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [bookQuery, setBookQuery] = useState('');
  const [clock, setClock] = useState(() => formatTime(Date.now()));
  const [quoteDraft, setQuoteDraft] = useState<QuoteDraft | null>(null);
  const [quoteId, setQuoteId] = useState<number | null>(null);
  const incognito = useSetting('incognito');
  /** Number of chapters that finished loading in the page. */
  const [readyCount, setReadyCount] = useState(0);

  // Language the novel is read in when it is not its original language.
  const wantedLang = novel ? activeTranslationLang(novel) : null;
  // Language displayed (null = original): quotes belong to one version of the text.
  const lang = useMemo(
    () => (wantedLang && getTranslation(getDb(), chapterId, wantedLang) ? wantedLang : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chapterId, wantedLang, contentVersion],
  );
  const bilingual = useSetting('bilingualReading');
  const chapterQuotes = useQuery(
    () => listChapterQuoteAnchors(getDb(), chapterId, lang),
    ['quotes'],
    [chapterId, lang],
  );
  const editedQuote = useQuery(
    () =>
      quoteId === null || novelId === null
        ? null
        : (listQuotes(getDb(), { novelId }).find((quote) => quote.id === quoteId) ?? null),
    ['quotes'],
    [quoteId, novelId],
  );

  const insets: ReaderInsets = useMemo(
    () => ({ top: safeInsets.top, bottom: safeInsets.bottom }),
    [safeInsets.top, safeInsets.bottom],
  );
  const pageTheme = findTheme(settings);
  const pageIsDark = relativeLuminance(pageTheme.background) < 0.4;

  // Values read when a chapter is loaded, without reloading it when they change.
  const latest = useRef({ settings, insets });
  useEffect(() => {
    latest.current = { settings, insets };
  });
  const ready = useRef(false);
  const sliding = useRef(false);
  const dirty = useRef(false);
  const selection = useRef<{ text: string; anchor: Anchor | null }>({ text: '', anchor: null });
  const afterFlush = useRef<(() => void) | null>(null);

  const send = useCallback((command: object) => {
    webView.current?.injectJavaScript(`window.LN&&window.LN.cmd(${JSON.stringify(command)});true;`);
  }, []);

  // ------------------------------------------------------------------ document

  const document = useMemo(() => {
    const current = loadReaderContext(getDb(), chapterId);
    if (!current) {
      return null;
    }
    const stored = readDisplayedChapter(getDb(), deviceFiles, current.novel, current.chapter);
    if (stored === null) {
      return null;
    }
    const cssPath = novelCssFile(current.novel.id);
    const flash = parseAnchor(anchorParam);
    const html = prepareChapterHtml(stored.html, rules);
    // The other version of each paragraph, when both have the same paragraphs.
    let other: string[] | null = null;
    if (stored.otherHtml !== null) {
      const mine = parseChapterBlocks(html).blocks.length;
      const theirs = parseChapterBlocks(prepareChapterHtml(stored.otherHtml, rules)).blocks;
      other = theirs.length === mine ? theirs.map((block) => serializeNodes(block.children)) : null;
    }
    return {
      key: `${chapterId}:${contentVersion}:${anchorParam ?? ''}:${stored.lang ?? ''}`,
      baseUrl: `${deviceFiles.uri(novelDir(current.novel.id))}/`,
      title: stored.title,
      translated: stored.lang !== null,
      hasOther: other !== null,
      html: buildReaderDocument({
        title: stored.title,
        html,
        settings,
        insets,
        config: {
          anchor: parseAnchor(current.chapter.positionAnchor),
          progress: current.chapter.progress,
          flash,
          quotes: chapterQuotes,
          other,
          bilingual,
        },
        endLabel: current.next ? t('reader.nextChapter') : t('reader.lastChapter'),
        endTitle: current.next ? current.next.title : t('reader.lastChapterHint'),
        lang: stored.lang ?? current.novel.originalLang,
        fontsUri: FONTS_URI,
        fontUri: (path) => deviceFiles.uri(path),
        extraCss: deviceFiles.exists(cssPath) ? deviceFiles.readText(cssPath) : undefined,
      }),
    };
    // Settings, insets and language are only read here: later changes are applied live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, contentVersion, anchorParam, rules, wantedLang]);

  // State reported by the page: it starts again from scratch with every loaded chapter.
  const documentKey = document?.key ?? '';
  const [progress, setProgress] = useKeyedState(documentKey, NO_PROGRESS);
  const [sliderValue, setSliderValue] = useKeyedState(documentKey, 0);
  const [searchState, setSearchState] = useKeyedState(documentKey, NO_SEARCH);
  const [autoScrolling, setAutoScrolling] = useKeyedState(documentKey, false);
  useEffect(() => {
    ready.current = false;
  }, [documentKey]);

  useEffect(() => {
    if (novelId !== null) {
      touchLastRead(getDb(), novelId, chapterId);
      dirty.current = true;
    }
  }, [novelId, chapterId]);

  // Settings changed in the panel are applied without reloading the chapter.
  useEffect(() => {
    if (ready.current) {
      send(settingsCommand(settings, insets, FONTS_URI, (path) => deviceFiles.uri(path)));
    }
  }, [settings, insets, send]);

  // Quotes added or removed while reading are underlined right away.
  useEffect(() => {
    if (ready.current) {
      send({ name: 'quotes', list: chapterQuotes });
    }
  }, [chapterQuotes, send]);

  // The other version appears or disappears under every paragraph without reloading.
  useEffect(() => {
    if (ready.current) {
      send({ name: 'bilingual', on: bilingual });
    }
  }, [bilingual, send]);

  // ------------------------------------------------------------------ translation

  const hasDocument = document !== null;
  const isTranslated = document?.translated ?? false;
  const needsTranslation = wantedLang !== null && hasDocument && !isTranslated;
  const translationKey = `${chapterId}:${wantedLang ?? ''}`;
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ key: string; error: TranslationError } | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const translationError = failure && failure.key === translationKey ? failure.error : null;

  // The chapter is translated when it is opened, then the following ones in advance.
  useEffect(() => {
    if (!needsTranslation || wantedLang === null) {
      return undefined;
    }
    let cancelled = false;
    translateNow(chapterId, wantedLang)
      .then(() => {
        if (!cancelled) {
          setFailure(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFailure({ key: `${chapterId}:${wantedLang}`, error: toTranslationError(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsTranslation, wantedLang, chapterId, attempt]);

  useEffect(() => {
    if (isTranslated && wantedLang !== null && novelId !== null) {
      translateAhead(novelId, chapterId, wantedLang);
    }
  }, [isTranslated, wantedLang, novelId, chapterId]);

  const retryTranslation = useCallback(() => {
    setFailure(null);
    setAttempt((value) => value + 1);
  }, []);

  const originalLang = novel?.originalLang ?? null;
  const fetchModels = useCallback(() => {
    if (!originalLang || wantedLang === null) {
      return;
    }
    setModelBusy(true);
    void missingModels(originalLang, wantedLang)
      .then(async (codes) => {
        for (const code of codes) {
          await downloadModel(code);
        }
        retryTranslation();
      })
      .catch(() => showToast(t('translation.modelFailed')))
      .finally(() => setModelBusy(false));
  }, [originalLang, wantedLang, retryTranslation, t]);

  const [selectionTranslation, setSelectionTranslation] = useState<{
    source: string;
    result: string | null;
  } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  // ------------------------------------------------------------------ reading time

  const hasText = document !== null;
  // While the voice reads, the time is counted as listening by the voice itself.
  const ttsStatus = useTts((state) => state.status);
  const ttsNovelId = useTts((state) => state.novelId);
  const ttsChapterId = useTts((state) => state.chapterId);
  const ttsSentence = useTts((state) => state.sentence);
  const ttsError = useTts((state) => state.error);
  const ttsActive = ttsStatus !== 'idle' && ttsNovelId === novelId;
  const voiceSpeaking = ttsActive && (ttsStatus === 'playing' || ttsStatus === 'loading');
  const session = useReadingSession(
    novelId !== null && chapter && hasText && !voiceSpeaking
      ? {
          novelId,
          chapterId,
          wordCount: chapter.wordCount ?? 0,
          startProgress: chapter.progress,
          lang,
          mode: 'read',
        }
      : null,
  );

  // ------------------------------------------------------------------ online text

  // An online chapter that is not on the phone is fetched when it is opened.
  const online = useChapterFetch(novel, chapter, !hasText);
  const nextChapter = context?.next ?? null;
  useEffect(() => {
    if (!hasText || !novel || !nextChapter) {
      return undefined;
    }
    // The next chapter is fetched in advance, once the current one has settled.
    const timer = setTimeout(() => preloadChapter(novel, nextChapter), 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasText, novel?.id, nextChapter?.id]);

  // ------------------------------------------------------------------ leaving

  const publishChanges = useCallback(() => {
    if (dirty.current) {
      dirty.current = false;
      invalidate('chapters', 'library', 'novel');
    }
  }, []);

  /** Asks the page for its exact position, then runs `then` (at most 300 ms later). */
  const flushThen = useCallback(
    (then: () => void) => {
      if (!ready.current) {
        then();
        return;
      }
      afterFlush.current = then;
      send({ name: 'flush' });
      setTimeout(() => {
        if (afterFlush.current === then) {
          afterFlush.current = null;
          then();
        }
      }, 300);
    },
    [send],
  );

  const leaving = useRef(false);
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (leaving.current) {
          return;
        }
        event.preventDefault();
        leaving.current = true;
        flushThen(() => {
          publishChanges();
          navigation.dispatch(event.data.action);
        });
      }),
    [navigation, flushThen, publishChanges],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && ready.current) {
        send({ name: 'flush' });
      }
    });
    return () => subscription.remove();
  }, [send]);

  // Screens opened above the reader (novel edit, rules) show fresh data.
  useEffect(() => navigation.addListener('blur', publishChanges), [navigation, publishChanges]);

  // ------------------------------------------------------------------ chapters

  const threshold = settings.readThreshold;
  const openChapter = useCallback(
    (target: Pick<Chapter, 'id'>, anchor?: Anchor) => {
      setPanel('none');
      setSearching(false);
      navigation.setParams({
        chapterId: target.id,
        anchor: anchor ? JSON.stringify(anchor) : undefined,
      });
    },
    [navigation],
  );

  const goNext = useCallback(() => {
    if (!context) {
      return;
    }
    // Moving on marks the chapter as read; reading it again starts from the top.
    saveReadingPosition(getDb(), context.chapter.id, { progress: 1, anchor: null }, threshold);
    dirty.current = true;
    if (context.next) {
      openChapter(context.next);
    } else {
      showToast(t('reader.lastChapterHint'));
    }
  }, [context, openChapter, threshold, t]);

  const goPrevious = useCallback(() => {
    if (context?.previous) {
      const previous = context.previous;
      flushThen(() => openChapter(previous));
    }
  }, [context, flushThen, openChapter]);

  // ------------------------------------------------------------------ messages

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: RuntimeMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as RuntimeMessage;
      } catch {
        return;
      }
      switch (message.type) {
        case 'ready':
          ready.current = true;
          setReadyCount((count) => count + 1);
          // Settings may have changed while the page was loading.
          send(
            settingsCommand(latest.current.settings, latest.current.insets, FONTS_URI, (path) =>
              deviceFiles.uri(path),
            ),
          );
          break;
        case 'progress':
          setProgress({ progress: message.progress, page: message.page, pages: message.pages });
          session.progress(message.progress);
          if (!sliding.current) {
            setSliderValue(message.progress);
          }
          break;
        case 'position': {
          saveReadingPosition(
            getDb(),
            chapterId,
            { progress: message.progress, anchor: message.anchor },
            latest.current.settings.readThreshold,
          );
          dirty.current = true;
          const then = afterFlush.current;
          afterFlush.current = null;
          then?.();
          break;
        }
        case 'activity':
          session.activity();
          break;
        case 'quoteTap':
          setQuoteDraft(null);
          setQuoteId(message.id);
          setPanel('quote');
          break;
        case 'tap':
          session.activity();
          setBarsVisible((visible) => !visible);
          break;
        case 'next':
          goNext();
          break;
        case 'previous':
          goPrevious();
          break;
        case 'selection':
          selection.current = { text: message.text, anchor: message.anchor ?? null };
          break;
        case 'search':
          setSearchState({ count: message.count, index: message.index });
          break;
        case 'autoScroll':
          setAutoScrolling(message.running);
          break;
        case 'link':
          if (/^https?:\/\//i.test(message.href)) {
            void Linking.openURL(message.href).catch(() => undefined);
          }
          break;
        default:
          break;
      }
    },
    [
      chapterId,
      goNext,
      goPrevious,
      send,
      session,
      setProgress,
      setSliderValue,
      setSearchState,
      setAutoScrolling,
    ],
  );

  // ------------------------------------------------------------------ selection menu

  const menuItems = useMemo(
    () => [
      { key: 'quote', label: t('reader.quote') },
      { key: 'copy', label: t('reader.copy') },
      { key: 'share', label: t('reader.share') },
      { key: 'searchBook', label: t('reader.searchBook') },
      { key: 'speak', label: t('tts.fromHere') },
      { key: 'translate', label: t('translation.translateSelection') },
      { key: 'glossary', label: t('translation.addToGlossary') },
      ...(document?.hasOther
        ? [
            {
              key: 'other',
              label: isTranslated
                ? t('translation.showOriginal')
                : t('translation.showTranslation'),
            },
          ]
        : []),
    ],
    [t, document?.hasOther, isTranslated],
  );

  const onMenuSelection = useCallback(
    (event: { nativeEvent: { key: string; selectedText: string } }) => {
      const text = (event.nativeEvent.selectedText || selection.current.text).trim();
      const anchor = selection.current.anchor;
      send({ name: 'clearSelection' });
      if (text === '') {
        return;
      }
      switch (event.nativeEvent.key) {
        case 'quote':
          if (anchor && novelId !== null) {
            setQuoteId(null);
            setQuoteDraft({ novelId, chapterId, text, anchor, lang });
            setPanel('quote');
          } else {
            showToast(t('reader.quoteUnavailable'));
          }
          break;
        case 'copy':
          void Clipboard.setStringAsync(text);
          showToast(t('reader.copied'));
          break;
        case 'share':
          void Share.share({ message: text }).catch(() => undefined);
          break;
        case 'searchBook':
          setBookQuery(text.slice(0, 80));
          setPanel('bookSearch');
          break;
        case 'speak':
          if (!anchor) {
            showToast(t('reader.quoteUnavailable'));
          } else if (ttsActive && ttsChapterId === chapterId) {
            readAloudFromPlace(anchor.b, anchor.o);
          } else {
            void startReadingAloud(chapterId, { kind: 'place', b: anchor.b, o: anchor.o });
          }
          break;
        case 'translate': {
          if (!novel) {
            break;
          }
          // A translated text goes back to the original language, the original to the other one.
          const from = lang ?? novel.originalLang ?? null;
          const to = lang
            ? novel.originalLang
            : (wantedLang ?? defaultTargetLang(from, i18n.language));
          if (!from || !to) {
            showToast(t('translation.error.language'));
            break;
          }
          const source = text.slice(0, 2000);
          setSelectionTranslation({ source, result: null });
          translateText(novel, source, from, to)
            .then((result) => setSelectionTranslation({ source, result }))
            .catch((error: unknown) => {
              setSelectionTranslation(null);
              showToast(t(`translation.error.${toTranslationError(error).kind}`));
            });
          break;
        }
        case 'glossary':
          if (novelId !== null) {
            navigation.navigate('glossary', { novelId, term: text.slice(0, 80) });
          }
          break;
        case 'other':
          if (anchor) {
            send({ name: 'other', b: anchor.b });
          }
          break;
        default:
          break;
      }
    },
    [
      send,
      t,
      i18n.language,
      navigation,
      novel,
      novelId,
      chapterId,
      lang,
      wantedLang,
      ttsActive,
      ttsChapterId,
    ],
  );

  // ------------------------------------------------------------------ search

  const closeSearch = useCallback(() => {
    setSearching(false);
    setSearchQuery('');
    send({ name: 'searchClear' });
  }, [send]);

  useEffect(() => {
    if (!searching) {
      return undefined;
    }
    const timer = setTimeout(() => send({ name: 'search', query: searchQuery }), 200);
    return () => clearTimeout(timer);
  }, [searching, searchQuery, send, documentKey]);

  useBackHandler(searching, closeSearch);

  const openSearchResult = useCallback(
    (targetChapterId: number, anchor: Anchor) => {
      setPanel('none');
      if (targetChapterId === chapterId) {
        send({ name: 'goTo', anchor, flash: true });
      } else {
        flushThen(() => openChapter({ id: targetChapterId }, anchor));
      }
    },
    [chapterId, flushThen, openChapter, send],
  );

  // ------------------------------------------------------------------ voice

  // The sentence being said is highlighted and kept visible.
  const spokenRange =
    ttsActive && ttsChapterId === chapterId && ttsSentence
      ? `${ttsSentence.b}:${ttsSentence.start}:${ttsSentence.end}`
      : '';
  const sendSpoken = useCallback(() => {
    if (!ready.current) {
      return;
    }
    const [b, start, end] = spokenRange.split(':').map(Number);
    send({ name: 'highlight', range: spokenRange === '' ? null : { b, start, end } });
  }, [send, spokenRange]);
  useEffect(() => {
    sendSpoken();
    // Sent again once a newly loaded chapter is ready.
  }, [sendSpoken, readyCount]);

  // When the voice moves on to another chapter, the reader follows it.
  const followedChapter = useRef<number | null>(null);
  useEffect(() => {
    const previous = followedChapter.current;
    followedChapter.current = ttsActive ? ttsChapterId : null;
    if (
      ttsActive &&
      ttsChapterId !== null &&
      ttsChapterId !== chapterId &&
      previous === chapterId
    ) {
      openChapter({ id: ttsChapterId });
    }
  }, [ttsActive, ttsChapterId, chapterId, openChapter]);

  useEffect(() => {
    if (ttsError) {
      showToast(ttsError === 'engine' ? t('tts.errorEngine') : t('tts.errorNoText'));
    }
  }, [ttsError, t]);

  const startVoice = useCallback(
    (from: 'start' | 'position') => {
      setBarsVisible(false);
      if (from === 'start') {
        void startReadingAloud(chapterId, { kind: 'start' });
      } else {
        // The exact place on screen is saved first: the voice starts from there.
        flushThen(() => void startReadingAloud(chapterId, { kind: 'position' }));
      }
    },
    [chapterId, flushThen],
  );

  // ------------------------------------------------------------------ device

  useReaderDevice(settings, {
    barsVisible: barsVisible || searching,
    volumeKeysAllowed: panel === 'none' && !searching,
    onVolumeKey: (direction) => send({ name: direction === 'down' ? 'next' : 'previous' }),
  });

  useEffect(() => {
    if (!settings.showClock) {
      return undefined;
    }
    const tick = () => setClock(formatTime(Date.now()));
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 20000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [settings.showClock]);

  const toggleFavorite = useCallback(() => {
    if (!chapter) {
      return;
    }
    void Haptics.selectionAsync();
    setChapterFavorite(getDb(), chapter.id, !chapter.isFavorite);
    invalidate('chapters');
  }, [chapter]);

  const toggleAutoScroll = useCallback(() => {
    setBarsVisible(false);
    send({ name: 'autoScroll', speed: autoScrolling ? 0 : settings.autoScrollSpeed });
  }, [autoScrolling, send, settings.autoScrollSpeed]);

  // The speed follows the setting while scrolling.
  useEffect(() => {
    if (autoScrolling) {
      send({ name: 'autoScroll', speed: settings.autoScrollSpeed });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoScrollSpeed]);

  // ------------------------------------------------------------------ render

  if (!context || !novel || !chapter) {
    return (
      <Screen bottom>
        <AppBar title="" onBack={navigation.goBack} />
        <EmptyState
          icon="book-off-outline"
          title={t('reader.missingTitle')}
          message={t('reader.missingMessage')}
        />
      </Screen>
    );
  }

  const chromeVisible = barsVisible || searching;
  const immersive = settings.hideStatusBar && !chromeVisible;
  const footerVisible = settings.showProgress || settings.showClock || settings.showBattery;

  return (
    <View style={[styles.screen, { backgroundColor: pageTheme.background }]}>
      <StatusBar
        hidden={immersive}
        style={(chromeVisible ? appTheme.dark : pageIsDark) ? 'light' : 'dark'}
      />

      {document ? (
        <WebView<NoExtraProps>
          key={document.key}
          ref={webView}
          source={{ html: document.html, baseUrl: document.baseUrl }}
          originWhitelist={['*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          javaScriptEnabled
          domStorageEnabled={false}
          setSupportMultipleWindows={false}
          textZoom={100}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          setBuiltInZoomControls={false}
          menuItems={menuItems}
          onCustomMenuSelection={onMenuSelection}
          onMessage={onMessage}
          style={[styles.web, { backgroundColor: pageTheme.background }]}
          containerStyle={{ backgroundColor: pageTheme.background }}
        />
      ) : (
        <Pressable
          accessibilityLabel={t('reader.toggleBars')}
          onPress={() => setBarsVisible((visible) => !visible)}
          style={[
            styles.web,
            { paddingTop: safeInsets.top + 56, backgroundColor: appTheme.colors.background },
          ]}
        >
          {online.error ? (
            <SourceErrorView
              error={online.error}
              onRetry={online.retry}
              webUrl={sourcePageUrl(novel, chapter) ?? undefined}
              pluginId={novel.pluginId ?? undefined}
            />
          ) : online.fetching ? (
            <View style={styles.loading} accessibilityLabel={t('reader.loadingChapter')}>
              <Skeleton height={28} width="70%" />
              {[0, 1, 2, 3, 4, 5, 6, 7].map((line) => (
                <Skeleton key={line} height={14} width={line % 3 === 2 ? '60%' : '100%'} />
              ))}
            </View>
          ) : (
            <EmptyState
              icon="cloud-off-outline"
              title={t('reader.notDownloadedTitle')}
              message={t('reader.notDownloadedMessage')}
            />
          )}
        </Pressable>
      )}

      {settings.warmth > 0 ? (
        <View
          pointerEvents="none"
          style={[styles.overlay, { backgroundColor: `rgba(255, 138, 20, ${settings.warmth})` }]}
        />
      ) : null}

      {footerVisible && document && !chromeVisible ? (
        <View
          pointerEvents="none"
          style={[styles.footer, { paddingBottom: safeInsets.bottom + 4 }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <FooterText color={pageTheme.text}>{settings.showClock ? clock : ''}</FooterText>
          <FooterText color={pageTheme.text}>
            {settings.showProgress
              ? progress.pages > 0
                ? `${progress.page + 1} / ${progress.pages} · ${formatPercent(progress.progress)}`
                : formatPercent(progress.progress)
              : ''}
          </FooterText>
          {settings.showBattery ? <BatteryText color={pageTheme.text} /> : <FooterText />}
        </View>
      ) : null}

      {searching ? (
        <View
          style={[
            styles.topBar,
            { backgroundColor: appTheme.colors.surface, paddingTop: safeInsets.top },
          ]}
        >
          <View style={styles.barRow}>
            <IconButton icon="arrow-left" label={t('common.close')} onPress={closeSearch} />
            <TextInput
              autoFocus
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('reader.searchPlaceholder')}
              accessibilityLabel={t('reader.searchPlaceholder')}
              placeholderTextColor={appTheme.colors.textDisabled}
              selectionColor={appTheme.colors.primary}
              returnKeyType="search"
              onSubmitEditing={() => send({ name: 'searchStep', step: 1 })}
              style={[styles.searchInput, { color: appTheme.colors.text }]}
            />
            {searchQuery !== '' ? (
              <AppText variant="label" secondary>
                {searchState.count > 0 ? `${searchState.index + 1} / ${searchState.count}` : '0'}
              </AppText>
            ) : null}
            <IconButton
              icon="chevron-up"
              label={t('reader.searchPrevious')}
              disabled={searchState.count === 0}
              onPress={() => send({ name: 'searchStep', step: -1 })}
            />
            <IconButton
              icon="chevron-down"
              label={t('reader.searchNext')}
              disabled={searchState.count === 0}
              onPress={() => send({ name: 'searchStep', step: 1 })}
            />
            <IconButton
              icon="book-search-outline"
              label={t('reader.searchBook')}
              onPress={() => {
                setBookQuery(searchQuery.trim());
                setPanel('bookSearch');
              }}
            />
          </View>
        </View>
      ) : barsVisible ? (
        <>
          <View
            style={[
              styles.topBar,
              { backgroundColor: appTheme.colors.surface, paddingTop: safeInsets.top },
            ]}
          >
            <AppBar
              title={novel.title}
              subtitle={document?.title ?? chapter.title}
              onBack={navigation.goBack}
              actions={
                <>
                  {incognito ? (
                    <View accessible accessibilityLabel={t('more.incognito')}>
                      <Icon name="incognito" size={20} color={appTheme.colors.textSecondary} />
                    </View>
                  ) : null}
                  <IconButton
                    icon={chapter.isFavorite ? 'star' : 'star-outline'}
                    label={
                      chapter.isFavorite ? t('reader.removeFavorite') : t('reader.addFavorite')
                    }
                    color={chapter.isFavorite ? appTheme.colors.warning : undefined}
                    onPress={toggleFavorite}
                  />
                  <IconButton
                    icon="format-list-bulleted"
                    label={t('reader.chapterList')}
                    onPress={() => setPanel('chapters')}
                  />
                  <Menu
                    label={t('reader.more')}
                    items={[
                      {
                        label: t('reader.search'),
                        icon: 'magnify',
                        disabled: !document,
                        onPress: () => setSearching(true),
                      },
                      {
                        label: t('reader.searchBook'),
                        icon: 'book-search-outline',
                        onPress: () => {
                          setBookQuery('');
                          setPanel('bookSearch');
                        },
                      },
                      ...(novel.origin === 'online'
                        ? [
                            {
                              label: t('sources.openWebView'),
                              icon: 'web' as const,
                              onPress: () => {
                                const url = sourcePageUrl(novel, chapter);
                                if (url) {
                                  navigation.navigate('webview', {
                                    url,
                                    pluginId: novel.pluginId ?? undefined,
                                    title: chapter.title,
                                  });
                                }
                              },
                            },
                          ]
                        : []),
                      {
                        label: t('tts.fromStart'),
                        icon: 'account-voice' as const,
                        disabled: !document,
                        onPress: () => startVoice('start'),
                      },
                      {
                        label: t('reader.editChapter'),
                        icon: 'pencil-outline',
                        disabled: !document,
                        onPress: () => navigation.navigate('chapterEdit', { chapterId }),
                      },
                      {
                        label: t('reader.replacements'),
                        icon: 'find-replace',
                        onPress: () =>
                          navigation.navigate('replacements', { novelId: novel.id, chapterId }),
                      },
                      ...(document?.hasOther
                        ? [
                            {
                              label: bilingual
                                ? t('translation.bilingualOff')
                                : t('translation.bilingualOn'),
                              icon: 'translate' as const,
                              onPress: () => setSetting('bilingualReading', !bilingual),
                            },
                          ]
                        : []),
                      ...(isTranslated
                        ? [
                            {
                              label: t('translation.report'),
                              icon: 'alert-circle-outline' as const,
                              onPress: () => setReportOpen(true),
                            },
                          ]
                        : []),
                      ...(document && settings.mode === 'scroll'
                        ? [
                            {
                              label: autoScrolling
                                ? t('reader.autoScrollStop')
                                : t('reader.autoScrollStart'),
                              icon: autoScrolling ? ('pause' as const) : ('play' as const),
                              onPress: toggleAutoScroll,
                            },
                          ]
                        : []),
                    ]}
                  />
                </>
              }
            />
          </View>

          <View
            style={[
              styles.bottomBar,
              { backgroundColor: appTheme.colors.surface, paddingBottom: safeInsets.bottom },
            ]}
          >
            <View style={styles.barRow}>
              <IconButton
                icon="skip-previous"
                label={t('reader.previousChapter')}
                disabled={!context.previous}
                onPress={goPrevious}
              />
              <Slider
                style={styles.slider}
                accessibilityLabel={t('reader.position')}
                minimumValue={0}
                maximumValue={1}
                value={sliderValue}
                disabled={!document}
                onSlidingStart={() => {
                  sliding.current = true;
                }}
                onValueChange={(value) => {
                  if (sliding.current) {
                    send({ name: 'seek', progress: value });
                  }
                }}
                onSlidingComplete={(value) => {
                  sliding.current = false;
                  setSliderValue(value);
                  send({ name: 'seek', progress: value });
                }}
                minimumTrackTintColor={appTheme.colors.primary as string}
                maximumTrackTintColor={appTheme.colors.border}
                thumbTintColor={appTheme.colors.primary as string}
              />
              <AppText variant="label" secondary style={styles.percent} center>
                {formatPercent(progress.progress)}
              </AppText>
              <IconButton
                icon="skip-next"
                label={t('reader.nextChapter')}
                disabled={!context.next}
                onPress={goNext}
              />
              <IconButton
                icon={ttsActive ? 'stop-circle-outline' : 'account-voice'}
                label={ttsActive ? t('tts.stop') : t('tts.readAloud')}
                color={ttsActive ? appTheme.colors.primary : undefined}
                disabled={!document && !ttsActive}
                onPress={() => (ttsActive ? stopReadingAloud() : startVoice('position'))}
                onLongPress={() => startVoice('start')}
              />
              <IconButton
                icon="format-size"
                label={t('reader.settings')}
                onPress={() => setPanel('settings')}
              />
            </View>
          </View>
        </>
      ) : null}

      {ttsActive && !searching ? (
        <TtsBar bottom={safeInsets.bottom + (barsVisible ? 56 + SPACING.md : SPACING.xl)} />
      ) : null}

      <ReaderSettingsSheet
        visible={panel === 'settings'}
        onClose={() => setPanel('none')}
        settings={settings}
        perNovel={perNovel}
        onChange={update}
        onPerNovelChange={setPerNovel}
        autoScrolling={autoScrolling}
        onToggleAutoScroll={document ? toggleAutoScroll : undefined}
      />
      <ChapterDrawer
        visible={panel === 'chapters'}
        onClose={() => setPanel('none')}
        novelId={novel.id}
        novelTitle={novel.title}
        currentChapterId={chapterId}
        lang={wantedLang}
        onSelect={(target) =>
          target.id === chapterId ? setPanel('none') : flushThen(() => openChapter(target))
        }
      />
      <QuoteEditorSheet
        visible={panel === 'quote'}
        onClose={() => setPanel('none')}
        draft={quoteDraft}
        quote={editedQuote}
      />
      <BookSearchSheet
        visible={panel === 'bookSearch'}
        onClose={() => setPanel('none')}
        novelId={novel.id}
        initialQuery={bookQuery}
        rules={rules}
        lang={wantedLang}
        onOpen={openSearchResult}
      />

      {needsTranslation && wantedLang !== null && !searching ? (
        <View
          pointerEvents="box-none"
          style={[styles.notice, { top: safeInsets.top + (barsVisible ? 64 : SPACING.sm) }]}
        >
          <View
            accessibilityLiveRegion="polite"
            style={[styles.noticeCard, { backgroundColor: appTheme.colors.surface }]}
          >
            <AppText variant="label">
              {translationError
                ? t(`translation.error.${translationError.kind}`)
                : modelBusy
                  ? t('translation.modelDownloading')
                  : t('translation.translating', {
                      language: languageInfo(wantedLang)?.name ?? wantedLang,
                    })}
            </AppText>
            {translationError && !modelBusy ? (
              <View style={styles.noticeActions}>
                {translationError.kind === 'modelMissing' ? (
                  <Button
                    compact
                    variant="tonal"
                    icon="download-outline"
                    label={t('translation.downloadModel')}
                    onPress={fetchModels}
                  />
                ) : translationError.engine === 'deepl' ? (
                  <Button
                    compact
                    variant="tonal"
                    label={t('translation.useOnDevice')}
                    onPress={() => {
                      switchToOnDeviceEngine(novel.id);
                      retryTranslation();
                    }}
                  />
                ) : (
                  <Button
                    compact
                    variant="tonal"
                    icon="refresh"
                    label={t('common.retry')}
                    onPress={retryTranslation}
                  />
                )}
                <Button
                  compact
                  variant="text"
                  label={t('translation.readOriginal')}
                  onPress={() => {
                    setReadingLang(getDb(), novel.id, null);
                    invalidate('novel', 'library');
                  }}
                />
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      <Dialog
        visible={selectionTranslation !== null}
        title={t('translation.translateSelection')}
        onClose={() => setSelectionTranslation(null)}
        actions={[
          ...(selectionTranslation?.result
            ? [
                {
                  label: t('reader.copy'),
                  onPress: () => {
                    void Clipboard.setStringAsync(selectionTranslation.result ?? '');
                    showToast(t('reader.copied'));
                  },
                },
              ]
            : []),
          { label: t('common.close'), onPress: () => setSelectionTranslation(null) },
        ]}
      >
        <View style={styles.translation}>
          <AppText variant="label" secondary>
            {selectionTranslation?.source ?? ''}
          </AppText>
          {selectionTranslation?.result === null ? (
            <Skeleton height={18} width="80%" />
          ) : (
            <AppText selectable>{selectionTranslation?.result ?? ''}</AppText>
          )}
        </View>
      </Dialog>

      <Dialog
        visible={reportOpen}
        title={t('translation.report')}
        message={t('translation.reportMessage')}
        onClose={() => setReportOpen(false)}
        actions={[
          { label: t('common.cancel'), onPress: () => setReportOpen(false) },
          {
            label: t('translation.glossary'),
            onPress: () => {
              setReportOpen(false);
              navigation.navigate('glossary', { novelId: novel.id });
            },
          },
          {
            label: t('translation.retranslate'),
            onPress: () => {
              setReportOpen(false);
              if (wantedLang !== null) {
                showToast(t('translation.retranslating'));
                translateNow(chapterId, wantedLang, true).catch((error: unknown) =>
                  showToast(t(`translation.error.${toTranslationError(error).kind}`)),
                );
              }
            },
          },
        ]}
      />
    </View>
  );
}

const NO_PROGRESS = { progress: 0, page: 0, pages: 0 };
const NO_SEARCH = { count: 0, index: -1 };

/** State that goes back to its initial value whenever `key` changes. */
function useKeyedState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [state, setState] = useState({ key, value: initial });
  const set = useCallback((value: T) => setState({ key, value }), [key]);
  return [state.key === key ? state.value : initial, set];
}

function FooterText({ color, children }: { color?: string; children?: string }) {
  return (
    <AppText variant="caption" color={color} style={styles.footerText} numberOfLines={1}>
      {children ?? ''}
    </AppText>
  );
}

/** Separate component: the battery is only watched when it is displayed. */
function BatteryText({ color }: { color: string }) {
  const level = useBatteryLevel();
  return <FooterText color={color}>{level >= 0 ? `${Math.round(level * 100)} %` : ''}</FooterText>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  web: { flex: 1 },
  loading: { padding: SPACING.xl, gap: SPACING.md },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    opacity: 0.6,
  },
  footerText: { flex: 1, fontSize: 11, lineHeight: 14, textAlign: 'center' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, elevation: 4 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, elevation: 8 },
  barRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.xs,
  },
  notice: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  noticeCard: {
    maxWidth: 420,
    marginHorizontal: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: 16,
    elevation: 4,
    gap: SPACING.xs,
  },
  noticeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  translation: { gap: SPACING.md },
  slider: { flex: 1, height: 44 },
  percent: { minWidth: 44 },
  searchInput: { flex: 1, minHeight: 44, fontFamily: FONTS.regular, fontSize: 16 },
});
