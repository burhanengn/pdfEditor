use std::collections::{HashMap, VecDeque};

use gp_pdf::{ReadingTheme, RenderedBitmap};

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct TileCacheKey {
    pub doc_id: String,
    pub page_index: usize,
    pub scale_milli: u32,
    pub rotation: u16,
    pub tile_x: i32,
    pub tile_y: i32,
    pub tile_w: u32,
    pub tile_h: u32,
    pub theme_id: u8,
    pub dark_invert: bool,
}

impl TileCacheKey {
    pub fn theme_to_id(theme: Option<ReadingTheme>) -> u8 {
        match theme.unwrap_or(ReadingTheme::Default) {
            ReadingTheme::Default => 0,
            ReadingTheme::Sepia => 1,
            ReadingTheme::Dark => 2,
        }
    }
}

struct CachedEntry {
    bitmap: RenderedBitmap,
    bytes: usize,
    gen_tick: u64,
}

/// Bounded byte-budget LRU tile cache shared across desktop, web-worker, and mobile cores.
pub struct TileCache {
    max_bytes: usize,
    used_bytes: usize,
    tick: u64,
    entries: HashMap<TileCacheKey, CachedEntry>,
    order: VecDeque<(TileCacheKey, u64)>,
}

impl TileCache {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            max_bytes: max_bytes.max(1024 * 1024),
            used_bytes: 0,
            tick: 0,
            entries: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    pub fn max_bytes(&self) -> usize {
        self.max_bytes
    }

    pub fn used_bytes(&self) -> usize {
        self.used_bytes
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn get(&mut self, key: &TileCacheKey) -> Option<&RenderedBitmap> {
        if !self.entries.contains_key(key) {
            return None;
        }
        self.tick += 1;
        let tick = self.tick;
        if let Some(entry) = self.entries.get_mut(key) {
            entry.gen_tick = tick;
            self.order.push_back((key.clone(), tick));
        }
        self.entries.get(key).map(|e| &e.bitmap)
    }

    pub fn insert(&mut self, key: TileCacheKey, bitmap: RenderedBitmap) {
        let bytes = bitmap.rgba.len();
        if bytes > self.max_bytes {
            return;
        }
        if let Some(old) = self.entries.remove(&key) {
            self.used_bytes = self.used_bytes.saturating_sub(old.bytes);
        }
        self.tick += 1;
        let tick = self.tick;
        self.used_bytes += bytes;
        self.entries.insert(
            key.clone(),
            CachedEntry {
                bitmap,
                bytes,
                gen_tick: tick,
            },
        );
        self.order.push_back((key, tick));
        self.trim(self.max_bytes);
    }

    pub fn trim(&mut self, target_bytes: usize) {
        while self.used_bytes > target_bytes {
            let Some((candidate_key, candidate_tick)) = self.order.pop_front() else {
                break;
            };
            let is_live = self
                .entries
                .get(&candidate_key)
                .map(|e| e.gen_tick == candidate_tick)
                .unwrap_or(false);
            if !is_live {
                continue;
            }
            if let Some(removed) = self.entries.remove(&candidate_key) {
                self.used_bytes = self.used_bytes.saturating_sub(removed.bytes);
            }
        }
    }

    pub fn invalidate_document(&mut self, doc_id: &str) {
        let mut freed = 0usize;
        self.entries.retain(|k, v| {
            if k.doc_id == doc_id {
                freed += v.bytes;
                false
            } else {
                true
            }
        });
        self.used_bytes = self.used_bytes.saturating_sub(freed);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
        self.used_bytes = 0;
    }
}
