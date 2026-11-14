# LNBook

Android reader for light novels and web novels: import EPUB and TXT files, follow online
sources, read offline.

> Work in progress.

## Install

Download the latest `LNBook-vX.Y.Z.apk` from the
[Releases](https://github.com/RedCodeSnoo/LNBook/releases) page and open it on your phone
(Android 8.0 or newer). Android will ask you to allow installing apps from this source the
first time.

## Build

```sh
npm ci
npm run prebuild
cd android && ./gradlew assembleRelease
```

## License

MIT. Online sources are provided by the plugins of
[LNReader/lnreader-plugins](https://github.com/LNReader/lnreader-plugins) (MIT).
