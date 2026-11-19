package dev.gullacpdf.android.engine

import android.graphics.Bitmap
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue

data class TileKey(
    val docId: String,
    val pageIndex: Int,
    val tileX: Int,
    val tileY: Int,
    val scaleBucket: String,
    val rotation: Int,
    val themeKey: String,
    val isPreview: Boolean = false,
    val transparentBg: Boolean = false,
)

class CachedTile(
    val bitmap: Bitmap,
    val imageBitmap: ImageBitmap,
    val width: Int,
    val height: Int,
    val byteCount: Int,
)

class DirectBufferPool(private val maxPoolSize: Int = 8) {
    private val pool = ConcurrentLinkedQueue<ByteBuffer>()

    fun acquire(minBytes: Int): ByteBuffer {
        var candidate: ByteBuffer?
        while (pool.poll().also { candidate = it } != null) {
            val buf = candidate!!
            if (buf.capacity() >= minBytes) {
                buf.clear()
                return buf
            }
        }
        return ByteBuffer.allocateDirect(minBytes)
    }

    fun release(buf: ByteBuffer) {
        if (pool.size < maxPoolSize && buf.capacity() <= 2 * 1024 * 1024) {
            buf.clear()
            pool.offer(buf)
        }
    }
}

/**
 * Dual-partition bounded LRU GPU ImageBitmap cache keyed by document, page, tile grid coordinates,
 * quantized scale bucket, rotation, theme, and transparency mode. Separating previews from high-res
 * zoom tiles guarantees high-DPI zoom bursts never evict instant base/preview fallback buckets.
 */
class TileBitmapCache(maxBytes: Int = 96 * 1024 * 1024) {
    private val keysIndex = ConcurrentHashMap.newKeySet<TileKey>()
    private val totalBudget = maxBytes.coerceAtLeast(16 * 1024 * 1024)

    private fun buildLru(budgetBytes: Int) = object : LruCache<TileKey, CachedTile>(budgetBytes) {
        override fun sizeOf(key: TileKey, value: CachedTile): Int = value.byteCount

        override fun entryRemoved(
            evicted: Boolean,
            key: TileKey,
            oldValue: CachedTile,
            newValue: CachedTile?,
        ) {
            keysIndex.remove(key)
        }
    }

    private val previewLru = buildLru((totalBudget / 4).coerceAtLeast(8 * 1024 * 1024))
    private val tileLru = buildLru((totalBudget - (totalBudget / 4)).coerceAtLeast(16 * 1024 * 1024))

    private fun targetLru(key: TileKey): LruCache<TileKey, CachedTile> =
        if (key.isPreview) previewLru else tileLru

    fun get(key: TileKey): CachedTile? = targetLru(key).get(key)

    fun contains(key: TileKey): Boolean = targetLru(key).get(key) != null

    fun put(key: TileKey, bitmap: Bitmap) {
        val entry = CachedTile(
            bitmap = bitmap,
            imageBitmap = bitmap.asImageBitmap(),
            width = bitmap.width,
            height = bitmap.height,
            byteCount = bitmap.allocationByteCount.coerceAtLeast(bitmap.width * bitmap.height * 4),
        )
        keysIndex.add(key)
        targetLru(key).put(key, entry)
    }

    fun invalidateDoc(docId: String) {
        val toRemove = keysIndex.filter { it.docId == docId }
        for (k in toRemove) {
            targetLru(k).remove(k)
        }
    }

    fun trim(critical: Boolean = false) {
        if (critical) {
            tileLru.trimToSize(tileLru.maxSize() / 4)
            previewLru.trimToSize(previewLru.maxSize() / 2)
        } else {
            tileLru.trimToSize(tileLru.maxSize() / 2)
        }
    }

    fun clear() {
        tileLru.evictAll()
        previewLru.evictAll()
        keysIndex.clear()
    }
}
