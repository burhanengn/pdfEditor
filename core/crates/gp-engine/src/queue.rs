use std::{
    cmp::Ordering,
    collections::{BinaryHeap, HashMap},
};

use gp_pdf::{CancellationFlag, TileRenderRequest};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum RenderPriority {
    VisibleTile = 0,
    TextSearch = 1,
    AdjacentTile = 2,
    Thumbnail = 3,
    Prefetch = 4,
}

#[derive(Debug, Clone)]
pub enum EngineJobPayload {
    RenderTile(TileRenderRequest),
    ExtractPageText { doc_id: String, page_index: usize },
    SearchPage { doc_id: String, page_index: usize, query: String },
}

#[derive(Debug, Clone)]
pub struct QueuedEngineTask {
    pub task_id: u64,
    pub scope: String,
    pub priority: RenderPriority,
    pub seq: u64,
    pub payload: EngineJobPayload,
    pub cancel: CancellationFlag,
}

impl PartialEq for QueuedEngineTask {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority && self.seq == other.seq && self.task_id == other.task_id
    }
}

impl Eq for QueuedEngineTask {}

impl PartialOrd for QueuedEngineTask {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for QueuedEngineTask {
    fn cmp(&self, other: &Self) -> Ordering {
        // BinaryHeap is a max-heap; reverse comparisons so lower RenderPriority & earlier seq pop first.
        other
            .priority
            .cmp(&self.priority)
            .then_with(|| other.seq.cmp(&self.seq))
            .then_with(|| other.task_id.cmp(&self.task_id))
    }
}

/// Single-thread priority task queue + cancellation token registry matching Decision D2.
pub struct RenderQueue {
    heap: BinaryHeap<QueuedEngineTask>,
    tokens: HashMap<u64, (String, CancellationFlag)>,
    next_task_id: u64,
    next_seq: u64,
}

impl Default for RenderQueue {
    fn default() -> Self {
        Self::new()
    }
}

impl RenderQueue {
    pub fn new() -> Self {
        Self {
            heap: BinaryHeap::new(),
            tokens: HashMap::new(),
            next_task_id: 1,
            next_seq: 1,
        }
    }

    pub fn enqueue(
        &mut self,
        scope: impl Into<String>,
        priority: RenderPriority,
        payload: EngineJobPayload,
    ) -> (u64, CancellationFlag) {
        let task_id = self.next_task_id;
        self.next_task_id += 1;
        let seq = self.next_seq;
        self.next_seq += 1;

        let scope = scope.into();
        let cancel = CancellationFlag::new();
        self.tokens.insert(task_id, (scope.clone(), cancel.clone()));
        self.heap.push(QueuedEngineTask {
            task_id,
            scope,
            priority,
            seq,
            payload,
            cancel: cancel.clone(),
        });
        (task_id, cancel)
    }

    pub fn cancel_task(&mut self, task_id: u64) -> bool {
        if let Some((_, flag)) = self.tokens.remove(&task_id) {
            flag.cancel();
            true
        } else {
            false
        }
    }

    /// Cancels every queued or active task matching `scope` (e.g. stale zoom level or viewport).
    pub fn cancel_scope(&mut self, scope: &str) -> usize {
        let mut count = 0usize;
        self.tokens.retain(|_, (task_scope, flag)| {
            if task_scope == scope {
                flag.cancel();
                count += 1;
                false
            } else {
                true
            }
        });
        count
    }

    /// Pops the highest-priority non-cancelled task ready for execution on the single PDFium thread.
    pub fn pop_next(&mut self) -> Option<QueuedEngineTask> {
        while let Some(task) = self.heap.pop() {
            if task.cancel.is_cancelled() {
                self.tokens.remove(&task.task_id);
                continue;
            }
            return Some(task);
        }
        None
    }

    pub fn complete_task(&mut self, task_id: u64) {
        self.tokens.remove(&task_id);
    }

    pub fn pending_len(&self) -> usize {
        self.heap.len()
    }
}
