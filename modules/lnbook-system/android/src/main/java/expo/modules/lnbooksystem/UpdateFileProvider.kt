package expo.modules.lnbooksystem

import androidx.core.content.FileProvider

/** Own provider class, so that it never collides with the provider of another library. */
class UpdateFileProvider : FileProvider()
