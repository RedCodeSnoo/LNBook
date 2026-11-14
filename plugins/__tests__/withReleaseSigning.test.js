const { applyReleaseSigning } = require('../withReleaseSigning');

const GRADLE = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled true
        }
    }
}
`;

describe('applyReleaseSigning', () => {
  it('adds a release signing config driven by environment variables', () => {
    const result = applyReleaseSigning(GRADLE);
    expect(result).toContain('storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))');
    expect(result).toContain(
      'signingConfig System.getenv("ANDROID_KEYSTORE_PATH") ? signingConfigs.release : signingConfigs.debug',
    );
  });

  it('keeps the debug build type on the debug key', () => {
    const result = applyReleaseSigning(GRADLE);
    expect(result).toMatch(/debug \{\s+signingConfig signingConfigs\.debug/);
  });

  it('is idempotent', () => {
    const once = applyReleaseSigning(GRADLE);
    expect(applyReleaseSigning(once)).toBe(once);
  });

  it('fails loudly when the Gradle template changes', () => {
    expect(() => applyReleaseSigning('android {}')).toThrow(/signingConfigs block not found/);
  });
});
