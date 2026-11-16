use gp_model::{Command, DocumentSnapshot, DocumentStore, ModelError};
use thiserror::Error;

use crate::{queue::RenderQueue, tile_cache::TileCache};

#[derive(Debug, Error)]
pub enum EngineError {
    #[error(transparent)]
    Model(#[from] ModelError),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

/// Unified Rust session state holding document commands/history, priority render queue,
/// and bounded LRU tile cache for both Wasm Web Workers and Flutter FFI.
pub struct EngineSession {
    pub store: DocumentStore,
    pub queue: RenderQueue,
    pub tile_cache: TileCache,
}

impl Default for EngineSession {
    fn default() -> Self {
        Self::new(64 * 1024 * 1024)
    }
}

impl EngineSession {
    pub fn new(tile_cache_budget_bytes: usize) -> Self {
        Self {
            store: DocumentStore::default(),
            queue: RenderQueue::new(),
            tile_cache: TileCache::new(tile_cache_budget_bytes),
        }
    }

    pub fn from_snapshot(snapshot: DocumentSnapshot, tile_cache_budget_bytes: usize) -> Self {
        Self {
            store: DocumentStore::new(snapshot),
            queue: RenderQueue::new(),
            tile_cache: TileCache::new(tile_cache_budget_bytes),
        }
    }

    pub fn load_snapshot_json(&mut self, json: &str) -> Result<(), EngineError> {
        self.store = DocumentStore::from_json(json)?;
        self.tile_cache.clear();
        Ok(())
    }

    pub fn export_snapshot_json(&self) -> Result<String, EngineError> {
        Ok(self.store.to_json()?)
    }

    pub fn apply_command_json(&mut self, command_json: &str) -> Result<String, EngineError> {
        let cmd: Command = serde_json::from_str(command_json)?;
        self.store.execute(cmd)?;
        self.export_snapshot_json()
    }

    pub fn undo(&mut self) -> Result<bool, EngineError> {
        Ok(self.store.undo()?)
    }

    pub fn redo(&mut self) -> Result<bool, EngineError> {
        Ok(self.store.redo()?)
    }

    pub fn can_undo(&self) -> bool {
        self.store.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.store.can_redo()
    }

    pub fn revision(&self) -> u64 {
        self.store.change_counter
    }

    pub fn trim_memory(&mut self, target_bytes: usize) {
        self.tile_cache.trim(target_bytes);
    }
}
