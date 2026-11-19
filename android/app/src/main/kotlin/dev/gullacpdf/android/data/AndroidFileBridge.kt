package dev.gullacpdf.android.data

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.provider.Settings
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream

data class GpOpenRequest(
    val sourceId: String,
    val uris: List<String>,
    val displayName: String,
    val sizeBytes: Long? = null,
    val writable: Boolean = false,
    val origin: String = "view",
)

data class GpWorkCopyResult(
    val workPath: String,
    val displayName: String,
    val byteSize: Long,
)

class AndroidFileBridge(private val context: Context) {
    companion object {
        private const val STREAM_BUFFER_BYTES = 64 * 1024
        private val KNOWN_EXTENSIONS = listOf(".pdf", ".png", ".jpg", ".jpeg", ".webp", ".ttf", ".otf")
    }

    fun extractOpenRequest(intent: Intent?): GpOpenRequest? {
        if (intent == null) return null
        val origin = when (intent.action) {
            Intent.ACTION_VIEW -> "view"
            Intent.ACTION_SEND -> "send"
            Intent.ACTION_SEND_MULTIPLE -> "sendMultiple"
            else -> return null
        }
        val uris = collectUrisFromIntent(intent).filter { isSafeExternalUri(it) }
        if (uris.isEmpty()) return null
        return buildRequest(uris, intent.flags, origin, defaultExt = ".pdf")
    }

    fun buildRequestFromPickedUris(uris: List<Uri>, defaultExt: String): GpOpenRequest? {
        if (uris.isEmpty()) return null
        for (u in uris) {
            try {
                context.contentResolver.takePersistableUriPermission(
                    u,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            } catch (_: SecurityException) {}
        }
        return buildRequest(uris, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION, "picker", defaultExt)
    }

    private fun buildRequest(
        uris: List<Uri>,
        intentFlags: Int,
        origin: String,
        defaultExt: String,
    ): GpOpenRequest {
        val primary = uris.first()
        val ext = inferExtensionForUri(primary) ?: defaultExt
        val displayName = sanitizeFileName(
            queryDisplayName(primary) ?: primary.lastPathSegment ?: "document$ext",
            fallbackExt = ext,
        )
        val sizeBytes = queryFileSize(primary)
        val hasWrite = (intentFlags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0
        val supportsWrite = checkDocumentSupportsWrite(primary)
        return GpOpenRequest(
            sourceId = primary.toString(),
            uris = uris.map { it.toString() },
            displayName = displayName,
            sizeBytes = sizeBytes,
            writable = hasWrite && supportsWrite,
            origin = origin,
        )
    }

    private fun collectUrisFromIntent(intent: Intent): List<Uri> {
        val out = mutableListOf<Uri>()
        intent.data?.let { out.add(it) }
        if (intent.action == Intent.ACTION_SEND) {
            @Suppress("DEPRECATION")
            val stream: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                intent.getParcelableExtra(Intent.EXTRA_STREAM)
            }
            if (stream != null && !out.contains(stream)) out.add(stream)
        } else if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            @Suppress("DEPRECATION")
            val list: ArrayList<Uri>? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
            }
            list?.forEach { if (!out.contains(it)) out.add(it) }
        }
        val clip: ClipData? = intent.clipData
        if (clip != null) {
            for (i in 0 until clip.itemCount) {
                val u = clip.getItemAt(i).uri
                if (u != null && !out.contains(u)) out.add(u)
            }
        }
        return out
    }

    fun isSafeExternalUri(uri: Uri): Boolean {
        if (uri.scheme == "content") return true
        if (uri.scheme == "file") {
            val rawPath = uri.path ?: return false
            val canonical = try {
                File(rawPath).canonicalPath
            } catch (_: Exception) {
                return false
            }
            val privateRoots = listOfNotNull(
                try { File(context.applicationInfo.dataDir).canonicalPath } catch (_: Exception) { null },
                context.filesDir.canonicalPath,
                context.cacheDir.canonicalPath,
            )
            return privateRoots.none { canonical.startsWith(it) }
        }
        return false
    }

    suspend fun copyToWorkFile(sourceUriStr: String, preferredName: String? = null): GpWorkCopyResult =
        withContext(Dispatchers.IO) {
            val uri = Uri.parse(sourceUriStr)
            if (!isSafeExternalUri(uri)) {
                throw SecurityException("Access to private storage URI rejected")
            }
            val workDir = File(context.cacheDir, "work").apply { mkdirs() }
            val inferredExt = inferExtensionForUri(uri) ?: ""
            val safeName = sanitizeFileName(
                raw = preferredName ?: queryDisplayName(uri) ?: "document${if (inferredExt.isEmpty()) ".pdf" else inferredExt}",
                fallbackExt = if (inferredExt.isEmpty()) ".pdf" else inferredExt,
            )
            val destFile = File(workDir, "${System.currentTimeMillis()}_$safeName")
            var copied = 0L
            try {
                val input = openReadableStream(uri)
                    ?: throw IllegalStateException("Cannot open input stream for URI")
                input.use { stream ->
                    FileOutputStream(destFile).use { out ->
                        val buffer = ByteArray(STREAM_BUFFER_BYTES)
                        while (true) {
                            val read = stream.read(buffer)
                            if (read < 0) break
                            out.write(buffer, 0, read)
                            copied += read
                        }
                        out.flush()
                    }
                }
                GpWorkCopyResult(
                    workPath = destFile.absolutePath,
                    displayName = safeName,
                    byteSize = copied,
                )
            } catch (e: Exception) {
                destFile.delete()
                throw e
            }
        }

    suspend fun writeFileToUri(srcPath: String, targetUriStr: String) = withContext(Dispatchers.IO) {
        val src = File(srcPath)
        if (!src.exists()) throw IllegalStateException("Missing compiled file: $srcPath")
        val targetUri = Uri.parse(targetUriStr)
        val out = try {
            context.contentResolver.openOutputStream(targetUri, "wt")
        } catch (_: UnsupportedOperationException) {
            context.contentResolver.openOutputStream(targetUri, "w")
        } catch (_: IllegalArgumentException) {
            context.contentResolver.openOutputStream(targetUri, "w")
        } ?: throw IllegalStateException("Cannot open output stream for target URI")
        out.use { outputStream ->
            FileInputStream(src).use { inputStream ->
                val buf = ByteArray(STREAM_BUFFER_BYTES)
                while (true) {
                    val read = inputStream.read(buf)
                    if (read < 0) break
                    outputStream.write(buf, 0, read)
                }
                outputStream.flush()
            }
        }
    }

    suspend fun sharePdf(activity: Activity, srcPath: String, displayName: String) {
        val uri = withContext(Dispatchers.IO) {
            val exportDir = File(context.filesDir, "exports").apply { mkdirs() }
            val dest = File(exportDir, sanitizeFileName(displayName))
            File(srcPath).copyTo(dest, overwrite = true)
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", dest)
        }
        val shareIntent = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TITLE, displayName)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(Intent.createChooser(shareIntent, displayName))
    }

    suspend fun openInOtherApp(activity: Activity, srcPath: String, displayName: String) {
        val uri = withContext(Dispatchers.IO) {
            val exportDir = File(context.filesDir, "exports").apply { mkdirs() }
            val dest = File(exportDir, sanitizeFileName(displayName))
            File(srcPath).copyTo(dest, overwrite = true)
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", dest)
        }
        val viewIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/pdf")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(Intent.createChooser(viewIntent, displayName))
    }

    fun printPdf(activity: Activity, srcPath: String, displayName: String) {
        val src = File(srcPath)
        if (!src.exists()) throw IllegalStateException("Missing compiled PDF file")
        val printManager = activity.getSystemService(Context.PRINT_SERVICE) as? PrintManager
            ?: throw IllegalStateException("Android PrintManager unavailable")
        val safeName = sanitizeFileName(displayName)
        printManager.print(safeName, PdfPrintDocumentAdapter(src, safeName), PrintAttributes.Builder().build())
    }

    fun openDefaultAppSettings(activity: Activity) {
        val intent = Intent().apply {
            action = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Settings.ACTION_APP_OPEN_BY_DEFAULT_SETTINGS
            } else {
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS
            }
            data = Uri.fromParts("package", activity.packageName, null)
        }
        try {
            activity.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            activity.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", activity.packageName, null)
                },
            )
        }
    }

    private fun openReadableStream(uri: Uri): InputStream? {
        try {
            context.contentResolver.openInputStream(uri)?.let { return it }
        } catch (_: Exception) {}
        try {
            val pfd = context.contentResolver.openFileDescriptor(uri, "r")
            if (pfd != null) return ParcelFileDescriptor.AutoCloseInputStream(pfd)
        } catch (_: Exception) {}
        if (uri.scheme == "file" && uri.path != null) {
            val f = File(uri.path!!)
            if (f.exists() && f.canRead()) return FileInputStream(f)
        }
        return null
    }

    private fun queryDisplayName(uri: Uri): String? {
        if (uri.scheme == "file") return uri.path?.let { File(it).name }
        return try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
        } catch (_: Exception) {
            null
        }
    }

    private fun queryFileSize(uri: Uri): Long? {
        if (uri.scheme == "file") return uri.path?.let { File(it).takeIf(File::exists)?.length() }
        return try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
                ?.use { cursor -> if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null }
        } catch (_: Exception) {
            null
        }
    }

    private fun checkDocumentSupportsWrite(uri: Uri): Boolean {
        if (uri.scheme == "file") return uri.path?.let { File(it).canWrite() } ?: false
        return try {
            context.contentResolver.query(
                uri,
                arrayOf(DocumentsContract.Document.COLUMN_FLAGS),
                null,
                null,
                null,
            )?.use { cursor ->
                if (cursor.moveToFirst() && !cursor.isNull(0)) {
                    (cursor.getInt(0) and DocumentsContract.Document.FLAG_SUPPORTS_WRITE) != 0
                } else {
                    false
                }
            } ?: false
        } catch (_: Exception) {
            false
        }
    }

    private fun inferExtensionForUri(uri: Uri): String? {
        val name = queryDisplayName(uri) ?: uri.lastPathSegment
        if (!name.isNullOrBlank()) {
            val lower = name.lowercase()
            for (ext in KNOWN_EXTENSIONS) {
                if (lower.endsWith(ext)) return ext
            }
        }
        val mime = try {
            context.contentResolver.getType(uri)?.lowercase()
        } catch (_: Exception) {
            null
        } ?: return null
        return when {
            mime.contains("pdf") -> ".pdf"
            mime == "image/png" -> ".png"
            mime == "image/jpeg" || mime == "image/jpg" -> ".jpg"
            mime == "image/webp" -> ".webp"
            mime.contains("ttf") -> ".ttf"
            mime.contains("otf") -> ".otf"
            else -> MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?.let { ".$it" }
        }
    }

    fun sanitizeFileName(raw: String, fallbackExt: String = ".pdf"): String {
        val base = raw.replace(Regex("""[/\\:*?"<>|\u0000-\u001F]"""), "_").trim()
        val nonEmpty = if (base.isEmpty()) "document$fallbackExt" else base
        val lower = nonEmpty.lowercase()
        if (KNOWN_EXTENSIONS.any { lower.endsWith(it) }) return nonEmpty
        return "$nonEmpty$fallbackExt"
    }

    private class PdfPrintDocumentAdapter(
        private val file: File,
        private val jobName: String,
    ) : PrintDocumentAdapter() {
        override fun onLayout(
            oldAttributes: PrintAttributes?,
            newAttributes: PrintAttributes?,
            cancellationSignal: CancellationSignal?,
            callback: LayoutResultCallback?,
            extras: Bundle?,
        ) {
            if (cancellationSignal?.isCanceled == true) {
                callback?.onLayoutCancelled()
                return
            }
            val info = PrintDocumentInfo.Builder(jobName)
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
                .build()
            callback?.onLayoutFinished(info, true)
        }

        override fun onWrite(
            pages: Array<out PageRange>?,
            destination: ParcelFileDescriptor?,
            cancellationSignal: CancellationSignal?,
            callback: WriteResultCallback?,
        ) {
            if (destination == null) {
                callback?.onWriteFailed("Missing print destination")
                return
            }
            try {
                FileInputStream(file).use { input ->
                    FileOutputStream(destination.fileDescriptor).use { out ->
                        val buf = ByteArray(STREAM_BUFFER_BYTES)
                        while (true) {
                            if (cancellationSignal?.isCanceled == true) {
                                callback?.onWriteCancelled()
                                return
                            }
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                        }
                        out.flush()
                    }
                }
                callback?.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
            } catch (e: Exception) {
                callback?.onWriteFailed(e.message)
            }
        }
    }
}
