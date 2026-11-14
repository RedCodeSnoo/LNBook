/** "Open with": another app asks LNBook to open an EPUB or TXT file. */
import { File } from 'expo-file-system';
import { useEffect } from 'react';
import { Linking } from 'react-native';

import { importFiles } from './importFlow';

function isFileUrl(url: string | null | undefined): url is string {
  return !!url && /^(content|file):\/\//i.test(url);
}

function fileNameOf(url: string): string {
  try {
    const name = new File(url).name;
    if (name) {
      return name;
    }
  } catch {
    // Some content providers do not expose a name.
  }
  return decodeURIComponent(url.split('/').pop() ?? 'file');
}

function handle(url: string | null | undefined): void {
  if (isFileUrl(url)) {
    void importFiles([{ name: fileNameOf(url), uri: url }]);
  }
}

/** Imports the file the app was opened with, at launch and while it is running. */
export function useOpenWithImport(): void {
  useEffect(() => {
    void Linking.getInitialURL().then(handle);
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));
    return () => subscription.remove();
  }, []);
}
