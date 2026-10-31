package com.multipleride.driver

import android.net.Uri
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File

/** Cleanup is confined to private app cache; never deletes gallery or arbitrary files. */
class OnboardingFilesModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "OnboardingFiles"
  @ReactMethod
  fun removeTemporary(uri: String, promise: Promise) {
    try {
      val parsed = Uri.parse(uri)
      if (parsed.scheme != "file") { promise.resolve(false); return }
      val path = parsed.path ?: run { promise.resolve(false); return }
      val target = File(path).canonicalFile
      val root = context.cacheDir.canonicalFile
      if (!target.path.startsWith(root.path + File.separator) ||
          !target.name.startsWith("rn_image_picker_lib_temp_") || !target.isFile) {
        promise.resolve(false); return
      }
      promise.resolve(target.delete())
    } catch (_: Exception) { promise.reject("CACHE_CLEANUP_FAILED", "Temporary document could not be removed") }
  }
  @ReactMethod
  fun pruneTemporary(promise: Promise) {
    try {
      val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
      var count = 0
      context.cacheDir.listFiles()?.forEach { file ->
        if (file.isFile && file.name.startsWith("rn_image_picker_lib_temp_") &&
            file.canonicalFile.parentFile == context.cacheDir.canonicalFile && file.lastModified() < cutoff) {
          if (file.delete()) count++
        }
      }
      promise.resolve(count)
    } catch (_: Exception) { promise.reject("CACHE_CLEANUP_FAILED", "Temporary documents could not be removed") }
  }
}
class OnboardingFilesPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(OnboardingFilesModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
