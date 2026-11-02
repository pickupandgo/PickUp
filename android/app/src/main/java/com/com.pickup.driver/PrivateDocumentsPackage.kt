package com.multipleride.driver

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.media.ExifInterface
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.util.Base64
import android.view.WindowManager
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/** No public storage, file URIs, S3 keys, external viewers, or URL logging. */
class PrivateDocumentsModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private data class Document(val file: File, val mime: String, val expires: Long)
  private val documents = mutableMapOf<String, Document>()
  private val worker = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var generation = 0
  private val directory get() = File(context.cacheDir, "private_document_previews").apply { mkdirs() }
  override fun getName() = "PrivateDocuments"

  init { worker.execute { directory.listFiles()?.forEach { it.delete() } } }

  @ReactMethod fun open(url: String, mime: String, ttlMs: Double, promise: Promise) {
    val request = generation
    worker.execute {
      var file: File? = null
      try {
        if (mime !in listOf("image/jpeg", "image/png", "application/pdf")) throw UnsupportedOperationException()
        val uri = URL(url)
        require(uri.protocol == "https" && uri.userInfo == null)
        require(ttlMs.isFinite() && ttlMs > 0)
        val expires = System.currentTimeMillis() + ttlMs.toLong().coerceAtMost(60_000)
        val connection = uri.openConnection() as HttpsURLConnection
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 15_000
        connection.readTimeout = 15_000
        connection.setRequestProperty("Cache-Control", "no-store")
        connection.useCaches = false
        file = File(directory, UUID.randomUUID().toString())
        try {
          if (connection.responseCode in listOf(401, 403)) throw SecurityException()
          require(connection.responseCode == 200)
          require(connection.contentLengthLong <= 25L * 1024 * 1024)
          connection.inputStream.use { input -> file.outputStream().use { output ->
            val buffer = ByteArray(16 * 1024); var total = 0L
            while (true) {
              val count = input.read(buffer); if (count < 0) break
              total += count; require(total <= 25L * 1024 * 1024)
              check(request == generation && System.currentTimeMillis() < expires)
              output.write(buffer, 0, count)
            }
          } }
        } finally { connection.disconnect() }
        val pages = Arguments.createArray()
        if (mime == "application/pdf") {
          PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)).use { pdf ->
            require(pdf.pageCount in 1..200)
            for (index in 0 until pdf.pageCount) pdf.openPage(index).use { page ->
              pages.pushMap(Arguments.createMap().apply { putInt("width", page.width); putInt("height", page.height) })
            }
          }
        } else {
          val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          BitmapFactory.decodeFile(file.path, options)
          require(options.outWidth > 0 && options.outHeight > 0)
          val rotated = orientation(file) in listOf(ExifInterface.ORIENTATION_ROTATE_90, ExifInterface.ORIENTATION_ROTATE_270, ExifInterface.ORIENTATION_TRANSPOSE, ExifInterface.ORIENTATION_TRANSVERSE)
          pages.pushMap(Arguments.createMap().apply {
            putInt("width", if (rotated) options.outHeight else options.outWidth)
            putInt("height", if (rotated) options.outWidth else options.outHeight)
          })
        }
        check(request == generation && System.currentTimeMillis() < expires)
        val handle = UUID.randomUUID().toString()
        while (documents.size >= 8) documents.keys.firstOrNull()?.let { documents.remove(it)?.file?.delete() }
        documents[handle] = Document(file, mime, expires)
        main.postDelayed({ worker.execute { documents.remove(handle)?.file?.delete() } }, (expires - System.currentTimeMillis()).coerceAtLeast(1))
        promise.resolve(Arguments.createMap().apply { putString("handle", handle); putInt("pageCount", pages.size()); putArray("pages", pages) })
      } catch (exception: Exception) {
        file?.delete()
        val code = when (exception) { is SecurityException -> "EXPIRED"; is UnsupportedOperationException -> "UNSUPPORTED"; else -> "PREVIEW_UNAVAILABLE" }
        promise.reject(code, "Private preview could not be opened")
      }
    }
  }

  private fun orientation(file: File): Int = try { ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) } catch (_: Exception) { ExifInterface.ORIENTATION_NORMAL }

  @ReactMethod fun render(handle: String, pageIndex: Int, requestedWidth: Int, promise: Promise) {
    val request = generation
    worker.execute {
      var bitmap: Bitmap? = null
      try {
        val document = documents[handle] ?: throw IllegalStateException()
        check(document.expires > System.currentTimeMillis())
        val width = requestedWidth.coerceIn(100, 1800)
        if (document.mime == "application/pdf") {
          PdfRenderer(ParcelFileDescriptor.open(document.file, ParcelFileDescriptor.MODE_READ_ONLY)).use { pdf ->
            pdf.openPage(pageIndex).use { page ->
              val height = (width.toDouble() * page.height / page.width).toInt().coerceIn(1, 3600)
              bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
              bitmap!!.eraseColor(android.graphics.Color.WHITE)
              page.render(bitmap!!, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            }
          }
        } else {
          require(pageIndex == 0)
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          BitmapFactory.decodeFile(document.file.path, bounds)
          var sample = 1
          while (bounds.outWidth / sample > width * 2 || bounds.outHeight / sample > 3600) sample *= 2
          val decoded = BitmapFactory.decodeFile(document.file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: throw IllegalStateException()
          val transform = Matrix().apply {
            when (orientation(document.file)) {
              ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
              ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
              ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f, -1f)
              ExifInterface.ORIENTATION_TRANSPOSE -> { setRotate(90f); postScale(-1f, 1f) }
              ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
              ExifInterface.ORIENTATION_TRANSVERSE -> { setRotate(270f); postScale(-1f, 1f) }
              ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(270f)
            }
          }
          bitmap = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, transform, true)
          if (bitmap !== decoded) decoded.recycle()
        }
        check(request == generation && document.expires > System.currentTimeMillis())
        val output = ByteArrayOutputStream()
        bitmap!!.compress(Bitmap.CompressFormat.PNG, 100, output)
        promise.resolve("data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP))
      } catch (_: Exception) { promise.reject("PAGE_UNAVAILABLE", "Private document page could not be rendered") }
      finally { bitmap?.recycle() }
    }
  }

  @ReactMethod fun clear() {
    ++generation
    // Data-URI pages must not survive logout in React Native's decoded image cache.
    try { com.facebook.drawee.backends.pipeline.Fresco.getImagePipeline().clearMemoryCaches() } catch (_: Exception) { }
    worker.execute { documents.values.forEach { it.file.delete() }; documents.clear(); directory.listFiles()?.forEach { it.delete() } }
  }
  @ReactMethod fun secureScreen(enabled: Boolean) {
    main.post { context.currentActivity?.window?.let { if (enabled) it.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else it.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) } }
  }
  override fun invalidate() { clear(); super.invalidate() }
}

class PrivateDocumentsPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(PrivateDocumentsModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
