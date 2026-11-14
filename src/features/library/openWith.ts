/** "Open with" and "Share to": another app gives LNBook an EPUB or TXT file. */
import { useEffect } from 'react';

import { addIncomingFilesListener, takeIncomingFiles } from '../../../modules/lnbook-system';
import { importFiles } from './importFlow';

async function importIncoming(): Promise<void> {
  const files = await takeIncomingFiles();
  if (files.length > 0) {
    // The copies made for the import are removed once it is over.
    await importFiles(
      files.map((file) => ({ name: file.name, uri: file.uri, error: file.error, temporary: true })),
    );
  }
}

/** Imports the files the app was opened with, at launch and while it is running. */
export function useOpenWithImport(): void {
  useEffect(() => {
    void importIncoming();
    const subscription = addIncomingFilesListener(() => void importIncoming());
    return () => subscription.remove();
  }, []);
}
