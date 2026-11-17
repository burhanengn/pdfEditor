package dev.gullacpdf.gullacpdf_mobile

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Native Android OS bridge for "Birlikte Aç / Open With", Scoped Storage SAF workflows,
 * 64 KB streaming working-copy creation, atomic URI saves, and FileProvider sharing (04 §5.1, §6.2).
 */
class FileBridgePlugin(private val activity: Activity) :
    MethodChannel.MethodCallHandler, EventChannel.StreamHandler {

    companion object {
        const val METHOD_CHANNEL = "dev.gullacpdf/file_bridge"
        const val EVENT_CHANNEL = "dev.gullacpdf/file_events"
        private const val REQUEST_OPEN_DOCUMENT = 9101
        private const val REQUEST_CREATE_DOCUMENT = 9102
        private const val STREAM_BUFFER_BYTES = 64 * 1024
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioExecutor = Executors.newSingleThreadExecutor()
    private val cancelFlags = mutableMapOf<String, AtomicBoolean>()

    private var eventSink: EventChannel.EventSink? = null
    private var initialOpenRequest: Map<String, Any?>? = null
    private var pendingPickerResult: MethodChannel.Result? = null
    private var pendingCreateResult: MethodChannel.Result? = null
    private var pendingCreateSourcePath: String? = null

    fun attach(flutterEngine: FlutterEngine, launchIntent: Intent?) {
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, METHOD_CHANNEL)
            .setMethodCallHandler(this)
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, EVENT_CHANNEL)
            .setStreamHandler(this)
        if (launchIntent != null) {
            initialOpenRequest = extractOpenRequest(launchIntent)
        }
    }

    fun handleNewIntent(intent: Intent) {
        val req = extractOpenRequest(intent) ?: return
        initialOpenRequest = req
        emitEvent(mapOf("type" to "openRequest", "payload" to req))
    }

    fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode == REQUEST_OPEN_DOCUMENT) {
            val res = pendingPickerResult ?: return true
            pendingPickerResult = null
            if (resultCode != Activity.RESULT_OK || data == null) {
                res.success(null)
                return true
            }
            val uris = collectUrisFromIntent(data)
            if (uris.isEmpty()) {
                res.success(null)
                return true
            }
            for (u in uris) {
                try {
                    val flags = data.flags and
                        (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                    if (flags != 0) {
                        activity.contentResolver.takePersistableUriPermission(u, flags)
                    }
                } catch (_: SecurityException) {
                    // Non-persistable provider: temporary URI remains usable for working copy.
                }
            }
            res.success(buildRequestMap(uris, data.flags, origin = "picker", canPersist = true))
            return true
        }

        if (requestCode == REQUEST_CREATE_DOCUMENT) {
            val res = pendingCreateResult ?: return true
            val srcPath = pendingCreateSourcePath
            pendingCreateResult = null
            pendingCreateSourcePath = null
            val targetUri = data?.data
            if (resultCode != Activity.RESULT_OK || targetUri == null || srcPath == null) {
                res.success(null)
                return true
            }
            ioExecutor.execute {
                try {
                    try {
                        activity.contentResolver.takePersistableUriPermission(
                            targetUri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                        )
                    } catch (_: SecurityException) {}
                    writeFileToUri(srcPath, targetUri)
                    mainHandler.post {
                        res.success(
                            mapOf(
                                "uri" to targetUri.toString(),
                                "displayName" to sanitizeFileName(queryDisplayName(targetUri) ?: "edited.pdf"),
                            ),
                        )
                    }
                } catch (e: Exception) {
                    mainHandler.post { res.error("SAVE_FAILED", e.message, null) }
                }
            }
            return true
        }
        return false
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "getInitialOpenRequest" -> {
                result.success(initialOpenRequest)
            }
            "clearInitialOpenRequest" -> {
                initialOpenRequest = null
                result.success(null)
            }
            "copyToWorkFile" -> {
                val uriStr = call.argument<String>("sourceUri")
                val preferredName = call.argument<String>("displayName")
                val taskId = call.argument<String>("taskId") ?: UUID.randomUUID().toString()
                if (uriStr.isNullOrBlank()) {
                    result.error("INVALID_ARGS", "sourceUri is required", null)
                    return
                }
                copyUriToWorkFileAsync(taskId, Uri.parse(uriStr), preferredName, result)
            }
            "cancelCopyTask" -> {
                val taskId = call.argument<String>("taskId")
                if (taskId != null) {
                    cancelFlags[taskId]?.set(true)
                }
                result.success(null)
            }
            "openDocumentPicker" -> {
                val allowMultiple = call.argument<Boolean>("allowMultiple") ?: false
                launchOpenDocumentPicker(allowMultiple, result)
            }
            "createDocument" -> {
                val suggestedName = sanitizeFileName(call.argument<String>("suggestedName") ?: "document-edited.pdf")
                val srcPath = call.argument<String>("sourceWorkPath")
                if (srcPath.isNullOrBlank()) {
                    result.error("INVALID_ARGS", "sourceWorkPath is required", null)
                    return
                }
                launchCreateDocument(suggestedName, srcPath, result)
            }
            "saveToUri" -> {
                val srcPath = call.argument<String>("sourceWorkPath")
                val targetUri = call.argument<String>("targetUri")
                if (srcPath.isNullOrBlank() || targetUri.isNullOrBlank()) {
                    result.error("INVALID_ARGS", "sourceWorkPath and targetUri required", null)
                    return
                }
                ioExecutor.execute {
                    try {
                        writeFileToUri(srcPath, Uri.parse(targetUri))
                        mainHandler.post { result.success(true) }
                    } catch (e: Exception) {
                        mainHandler.post { result.error("WRITE_FAILED", e.message, null) }
                    }
                }
            }
            "shareFile" -> {
                val srcPath = call.argument<String>("sourceWorkPath")
                val displayName = sanitizeFileName(call.argument<String>("displayName") ?: "document.pdf")
                if (srcPath.isNullOrBlank()) {
                    result.error("INVALID_ARGS", "sourceWorkPath required", null)
                    return
                }
                sharePdfFile(srcPath, displayName, result)
            }
            "openInOtherApp" -> {
                val srcPath = call.argument<String>("sourceWorkPath")
                val displayName = sanitizeFileName(call.argument<String>("displayName") ?: "document.pdf")
                if (srcPath.isNullOrBlank()) {
                    result.error("INVALID_ARGS", "sourceWorkPath required", null)
                    return
                }
                openInOtherApp(srcPath, displayName, result)
            }
            "openDefaultAppSettings" -> {
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
                    result.success(true)
                } catch (_: Exception) {
                    val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.fromParts("package", activity.packageName, null)
                    }
                    activity.startActivity(fallback)
                    result.success(true)
                }
            }
            "getWorkCacheDir" -> {
                val workDir = File(activity.cacheDir, "work").apply { mkdirs() }
                result.success(workDir.absolutePath)
            }
            else -> result.notImplemented()
        }
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        eventSink = events
    }

    override fun onCancel(arguments: Any?) {
        eventSink = null
    }

    private fun emitEvent(payload: Map<String, Any?>) {
        mainHandler.post { eventSink?.success(payload) }
    }

    private fun extractOpenRequest(intent: Intent): Map<String, Any?>? {
        val action = intent.action ?: return null
        val origin = when (action) {
            Intent.ACTION_VIEW -> "view"
            Intent.ACTION_SEND -> "send"
            Intent.ACTION_SEND_MULTIPLE -> "sendMultiple"
            else -> return null
        }
        val uris = collectUrisFromIntent(intent)
        if (uris.isEmpty()) return null
        val safeUris = uris.filter { isSafeExternalUri(it) }
        if (safeUris.isEmpty()) return null
        return buildRequestMap(safeUris, intent.flags, origin, canPersist = false)
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

    /** Rejects file:// URIs attempting traversal into app-private directories (04 §5.1). */
    private fun isSafeExternalUri(uri: Uri): Boolean {
        if (uri.scheme == "content") return true
        if (uri.scheme == "file") {
            val rawPath = uri.path ?: return false
            val canonicalTarget = try {
                File(rawPath).canonicalPath
            } catch (_: Exception) {
                return false
            }
            val privateRoots = listOfNotNull(
                activity.dataDirSafePath(),
                activity.filesDir.canonicalPath,
                activity.cacheDir.canonicalPath,
            )
            return privateRoots.none { root -> canonicalTarget.startsWith(root) }
        }
        return false
    }

    private fun Activity.dataDirSafePath(): String? = try {
        File(applicationInfo.dataDir).canonicalPath
    } catch (_: Exception) {
        null
    }

    private fun buildRequestMap(
        uris: List<Uri>,
        intentFlags: Int,
        origin: String,
        canPersist: Boolean,
    ): Map<String, Any?> {
        val primary = uris.first()
        val displayName = sanitizeFileName(queryDisplayName(primary) ?: primary.lastPathSegment ?: "document.pdf")
        val sizeBytes = queryFileSize(primary)
        val hasGrantWrite = (intentFlags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0
        val supportsDocWrite = checkDocumentSupportsWrite(primary)
        val writable = hasGrantWrite && supportsDocWrite

        return mapOf(
            "sourceId" to primary.toString(),
            "uris" to uris.map { it.toString() },
            "displayName" to displayName,
            "sizeBytes" to sizeBytes,
            "writable" to writable,
            "canPersist" to canPersist,
            "origin" to origin,
        )
    }

    private fun queryDisplayName(uri: Uri): String? {
        if (uri.scheme == "file") return uri.path?.let { File(it).name }
        return try {
            activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                }
        } catch (_: Exception) {
            null
        }
    }

    private fun queryFileSize(uri: Uri): Long? {
        if (uri.scheme == "file") return uri.path?.let { File(it).takeIf(File::exists)?.length() }
        return try {
            activity.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
                }
        } catch (_: Exception) {
            null
        }
    }

    private fun checkDocumentSupportsWrite(uri: Uri): Boolean {
        if (uri.scheme == "file") {
            return uri.path?.let { File(it).canWrite() } ?: false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            try {
                activity.contentResolver.query(
                    uri,
                    arrayOf(DocumentsContract.Document.COLUMN_FLAGS),
                    null,
                    null,
                    null,
                )?.use { cursor ->
                    if (cursor.moveToFirst() && !cursor.isNull(0)) {
                        val flags = cursor.getInt(0)
                        return (flags and DocumentsContract.Document.FLAG_SUPPORTS_WRITE) != 0
                    }
                }
            } catch (_: Exception) {
                // Fall back cleanly: external providers like WhatsApp/Gmail don't support DocumentsContract write.
            }
        }
        return false
    }

    private fun copyUriToWorkFileAsync(
        taskId: String,
        uri: Uri,
        preferredName: String?,
        result: MethodChannel.Result,
    ) {
        if (!isSafeExternalUri(uri)) {
            result.error("UNSAFE_URI", "Access to private storage URI rejected.", null)
            return
        }
        val cancelled = AtomicBoolean(false)
        cancelFlags[taskId] = cancelled

        ioExecutor.execute {
            val workDir = File(activity.cacheDir, "work").apply { mkdirs() }
            val safeName = sanitizeFileName(preferredName ?: queryDisplayName(uri) ?: "document.pdf")
            val destFile = File(workDir, "${System.currentTimeMillis()}_${safeName}")
            val totalBytes = queryFileSize(uri) ?: -1L
            var copied = 0L

            try {
                val input = activity.contentResolver.openInputStream(uri)
                    ?: throw IllegalStateException("Cannot open input stream for URI")
                input.use { stream ->
                    FileOutputStream(destFile).use { out ->
                        val buffer = ByteArray(STREAM_BUFFER_BYTES)
                        while (true) {
                            if (cancelled.get()) {
                                destFile.delete()
                                mainHandler.post { result.error("CANCELLED", "Copy cancelled by user", null) }
                                return@execute
                            }
                            val read = stream.read(buffer)
                            if (read < 0) break
                            out.write(buffer, 0, read)
                            copied += read
                            emitEvent(
                                mapOf(
                                    "type" to "copyProgress",
                                    "taskId" to taskId,
                                    "bytesCopied" to copied,
                                    "totalBytes" to totalBytes,
                                ),
                            )
                        }
                        out.flush()
                    }
                }
                mainHandler.post {
                    cancelFlags.remove(taskId)
                    result.success(
                        mapOf(
                            "workPath" to destFile.absolutePath,
                            "displayName" to safeName,
                            "byteSize" to copied,
                        ),
                    )
                }
            } catch (e: Exception) {
                destFile.delete()
                cancelFlags.remove(taskId)
                mainHandler.post { result.error("COPY_FAILED", e.message, null) }
            }
        }
    }

    private fun writeFileToUri(srcPath: String, targetUri: Uri) {
        val src = File(srcPath)
        if (!src.exists()) throw IllegalStateException("Missing compiled file: $srcPath")
        val out = activity.contentResolver.openOutputStream(targetUri, "wt")
            ?: throw IllegalStateException("Cannot open output stream for target URI")
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

    private fun launchOpenDocumentPicker(allowMultiple: Boolean, result: MethodChannel.Result) {
        pendingPickerResult?.error("CANCELLED", "Superseded by another picker request", null)
        pendingPickerResult = result
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/pdf"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
            )
        }
        activity.startActivityForResult(intent, REQUEST_OPEN_DOCUMENT)
    }

    private fun launchCreateDocument(
        suggestedName: String,
        srcPath: String,
        result: MethodChannel.Result,
    ) {
        pendingCreateResult?.error("CANCELLED", "Superseded by another export request", null)
        pendingCreateResult = result
        pendingCreateSourcePath = srcPath
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/pdf"
            putExtra(Intent.EXTRA_TITLE, suggestedName)
        }
        activity.startActivityForResult(intent, REQUEST_CREATE_DOCUMENT)
    }

    private fun sharePdfFile(srcPath: String, displayName: String, result: MethodChannel.Result) {
        ioExecutor.execute {
            try {
                val exportDir = File(activity.filesDir, "exports").apply { mkdirs() }
                val dest = File(exportDir, displayName)
                File(srcPath).copyTo(dest, overwrite = true)
                val uri = FileProvider.getUriForFile(
                    activity,
                    "${activity.packageName}.fileprovider",
                    dest,
                )
                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                    type = "application/pdf"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    putExtra(Intent.EXTRA_TITLE, displayName)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                mainHandler.post {
                    activity.startActivity(Intent.createChooser(shareIntent, displayName))
                    result.success(true)
                }
            } catch (e: Exception) {
                mainHandler.post { result.error("SHARE_FAILED", e.message, null) }
            }
        }
    }

    private fun openInOtherApp(srcPath: String, displayName: String, result: MethodChannel.Result) {
        ioExecutor.execute {
            try {
                val exportDir = File(activity.filesDir, "exports").apply { mkdirs() }
                val dest = File(exportDir, displayName)
                File(srcPath).copyTo(dest, overwrite = true)
                val uri = FileProvider.getUriForFile(
                    activity,
                    "${activity.packageName}.fileprovider",
                    dest,
                )
                val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/pdf")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                mainHandler.post {
                    activity.startActivity(Intent.createChooser(viewIntent, displayName))
                    result.success(true)
                }
            } catch (e: Exception) {
                mainHandler.post { result.error("OPEN_OTHER_FAILED", e.message, null) }
            }
        }
    }

    private fun sanitizeFileName(raw: String): String {
        val base = raw.replace(Regex("""[/\\:*?"<>|\u0000-\u001F]"""), "_").trim()
        val nonEmpty = if (base.isEmpty()) "document.pdf" else base
        return if (nonEmpty.lowercase().endsWith(".pdf")) nonEmpty else "$nonEmpty.pdf"
    }
}
