#!/usr/bin/env python3
"""
Emulator upgrade test, checks made on the computer.

  compare <before> <after>    every table and every file of the app is still there, unchanged,
                              after installing the new version over the published one
  verify-zip <zip> <snapshot> the backup made by the new version opens, its checksums match,
                              and it holds every row and every file of the phone
"""
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import zipfile

SAVED_TABLES = [
    'categories', 'novels', 'volumes', 'chapters', 'chapter_translations', 'glossary_terms',
    'novel_categories', 'reading_sessions', 'history', 'quote_folders', 'quotes',
    'quote_folder_items', 'plugins', 'plugin_repos', 'text_replacements', 'settings',
]
# Written by the app itself at launch (update checks, automatic backups).
VOLATILE_SETTING = re.compile(r'(^last|At$|Check)', re.I)
# Files the app rewrites on its own; everything else must be identical.
VOLATILE_FILE = re.compile(r'^(logs|backups|\.backup-work)/')
SAVED_FILE = re.compile(r'^(novels|plugins|fonts)/')


def open_db(snapshot):
    """Opens a copy of the pulled database (the WAL is applied on the copy)."""
    work = tempfile.mkdtemp()
    for name in os.listdir(snapshot):
        if name.startswith('lnbook.db'):
            shutil.copy(os.path.join(snapshot, name), work)
    return sqlite3.connect(os.path.join(work, 'lnbook.db'))


def tables(db):
    names = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
    dump = {}
    for name in names:
        if name.startswith('sqlite_'):
            continue
        cursor = db.execute(f'SELECT * FROM "{name}"')
        columns = [c[0] for c in cursor.description]
        dump[name] = sorted(json.dumps(dict(zip(columns, row)), sort_keys=True) for row in cursor)
    return dump


def files(snapshot):
    out = {}
    with open(os.path.join(snapshot, 'files.sha256'), encoding='utf-8') as handle:
        for line in handle:
            line = line.rstrip('\n')
            if not line:
                continue
            digest, path = line.split('  ', 1)
            out[path[2:] if path.startswith('./') else path] = digest
    return out


def compare(before_dir, after_dir):
    problems = []
    before_db, after_db = tables(open_db(before_dir)), tables(open_db(after_dir))
    print('Tables before the update:', {name: len(rows) for name, rows in before_db.items()})
    for name, rows in before_db.items():
        after_rows = after_db.get(name)
        if after_rows is None:
            problems.append(f'table {name} disappeared')
            continue
        if name == 'settings':
            before_settings = {json.loads(r)['key']: json.loads(r)['value'] for r in rows}
            after_settings = {json.loads(r)['key']: json.loads(r)['value'] for r in after_rows}
            for key, value in before_settings.items():
                if key not in after_settings:
                    problems.append(f'setting {key} disappeared')
                elif after_settings[key] != value and not VOLATILE_SETTING.search(key):
                    problems.append(f'setting {key} changed: {value} -> {after_settings[key]}')
            continue
        missing = set(rows) - set(after_rows)
        if missing:
            problems.append(f'table {name}: {len(missing)} rows changed or missing, e.g. {sorted(missing)[0][:300]}')
    before_files, after_files = files(before_dir), files(after_dir)
    kept = [p for p in before_files if not VOLATILE_FILE.match(p)]
    print(f'Files before the update: {len(kept)} ({len([p for p in kept if SAVED_FILE.match(p)])} books, chapters, covers, sources, fonts)')
    for path in kept:
        if path not in after_files:
            problems.append(f'file {path} disappeared')
        elif after_files[path] != before_files[path]:
            problems.append(f'file {path} changed')
    with open(os.path.join(before_dir, 'dirs.txt'), encoding='utf-8') as b, open(os.path.join(after_dir, 'dirs.txt'), encoding='utf-8') as a:
        lost = set(b.read().split('\n')) - set(a.read().split('\n'))
    lost = {d for d in lost if d and not VOLATILE_FILE.match(d[2:] + '/')}
    if lost:
        problems.append(f'folders disappeared: {sorted(lost)[:5]}')
    report(problems, 'Every table and every file is intact after the update.')


def verify_zip(path, snapshot):
    problems = []
    db = open_db(snapshot)
    with zipfile.ZipFile(path) as archive:
        bad = archive.testzip()
        if bad:
            problems.append(f'damaged entry {bad}')
        names = archive.namelist()
        if names[0] != 'manifest.json':
            problems.append(f'first entry is {names[0]}, not manifest.json')
        manifest = json.loads(archive.read('manifest.json'))
        checksums = json.loads(archive.read('checksums.json'))['files']
        print('Manifest:', json.dumps(manifest, ensure_ascii=False))
        print(f'Zip: {os.path.getsize(path) / 1024 / 1024:.1f} MB, {len(names)} entries')
        for name in names:
            if name == 'checksums.json':
                continue
            data = archive.read(name)
            expected = checksums.get(name)
            if not expected:
                problems.append(f'{name} has no checksum')
            elif expected['size'] != len(data) or expected['sha256'] != hashlib.sha256(data).hexdigest():
                problems.append(f'{name}: checksum does not match')
        for table in SAVED_TABLES:
            rows = json.loads(archive.read(f'data/{table}.json'))
            count = db.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
            if table == 'settings':
                count = db.execute("SELECT count(*) FROM settings WHERE key NOT LIKE 'deepl%' AND key NOT LIKE 'secret%'").fetchone()[0]
            if len(rows) != count:
                problems.append(f'data/{table}.json: {len(rows)} rows, the phone has {count}')
        counts = manifest.get('counts', {})
        for key, table in [('novels', 'novels'), ('chapters', 'chapters'), ('quotes', 'quotes'),
                           ('readingSessions', 'reading_sessions'), ('history', 'history')]:
            count = db.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
            if counts.get(key) != count:
                problems.append(f'manifest counts.{key} = {counts.get(key)}, the phone has {count}')
        phone = {p: d for p, d in files(snapshot).items() if SAVED_FILE.match(p)}
        inside = {n[len('files/'):]: n for n in names if n.startswith('files/')}
        for file_path, digest in phone.items():
            if file_path not in inside:
                problems.append(f'file {file_path} is not in the backup')
            elif checksums[inside[file_path]]['sha256'] != digest:
                problems.append(f'file {file_path} differs from the phone')
        extra = set(inside) - set(phone)
        if extra:
            problems.append(f'{len(extra)} files in the backup are not on the phone, e.g. {sorted(extra)[0]}')
        if any(n.startswith('files/') and not SAVED_FILE.match(n[6:]) for n in names):
            problems.append('the backup holds files outside novels/, plugins/ and fonts/')
        print(f'Files of the phone in the backup: {len(phone)}')
    report(problems, 'The backup is complete and every checksum matches.')


def report(problems, success):
    if problems:
        print(f'{len(problems)} problem(s):')
        for problem in problems[:50]:
            print('  -', problem)
        sys.exit(1)
    print(success)


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'compare':
        compare(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == 'verify-zip':
        verify_zip(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
        sys.exit(2)
