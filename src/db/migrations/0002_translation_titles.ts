import type { Migration } from './types';

/** Translated chapter titles, kept next to the translated text (app version 0.6.0). */
export const migration0002: Migration = {
  version: 2,
  name: 'translation_titles',
  statements: ['ALTER TABLE `chapter_translations` ADD `title` text;'],
};
