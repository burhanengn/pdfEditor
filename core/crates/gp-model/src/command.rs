use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::types::{CanvasElement, DocumentSnapshot, PageMeta, PageNumberingConfig, RectBox};

pub const MAX_COMMAND_HISTORY: usize = 120;

#[derive(Debug, Error)]
pub enum ModelError {
    #[error("element not found: {0}")]
    ElementNotFound(String),
    #[error("page not found: {0}")]
    PageNotFound(String),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

/// Pure document command producing an exact inverse command for memory-light undo/redo (01 §2.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    AddElements {
        elements: Vec<CanvasElement>,
    },
    RemoveElements {
        ids: Vec<String>,
    },
    ReplaceElement {
        id: String,
        next: CanvasElement,
    },
    TransformElements {
        updates: Vec<ElementGeometryUpdate>,
    },
    SetPages {
        pages: Vec<PageMeta>,
    },
    RotatePages {
        page_ids: Vec<String>,
        delta_deg: i32,
    },
    SetPageNumbering {
        config: Option<PageNumberingConfig>,
    },
    Batch {
        commands: Vec<Command>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementGeometryUpdate {
    pub id: String,
    pub rect: RectBox,
    pub rotation: f64,
    pub opacity: f64,
    pub z_index: i32,
}

#[derive(Debug, Clone)]
pub struct DocumentStore {
    pub snapshot: DocumentSnapshot,
    past: Vec<Command>,
    future: Vec<Command>,
    pub change_counter: u64,
    pub last_saved_change_counter: u64,
}

impl Default for DocumentStore {
    fn default() -> Self {
        Self::new(DocumentSnapshot::default())
    }
}

impl DocumentStore {
    pub fn new(snapshot: DocumentSnapshot) -> Self {
        Self {
            snapshot,
            past: Vec::new(),
            future: Vec::new(),
            change_counter: 0,
            last_saved_change_counter: 0,
        }
    }

    pub fn from_json(json: &str) -> Result<Self, ModelError> {
        let snapshot: DocumentSnapshot = serde_json::from_str(json)?;
        Ok(Self::new(snapshot))
    }

    pub fn to_json(&self) -> Result<String, ModelError> {
        Ok(serde_json::to_string(&self.snapshot)?)
    }

    pub fn can_undo(&self) -> bool {
        !self.past.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.future.is_empty()
    }

    pub fn is_dirty(&self) -> bool {
        self.change_counter != self.last_saved_change_counter
    }

    pub fn mark_saved(&mut self) {
        self.last_saved_change_counter = self.change_counter;
    }

    pub fn select_elements(&mut self, ids: Vec<String>) {
        self.snapshot.selected_element_ids = ids;
    }

    pub fn execute(&mut self, cmd: Command) -> Result<(), ModelError> {
        let inverse = self.apply_and_invert(&cmd)?;
        if self.past.len() >= MAX_COMMAND_HISTORY {
            self.past.remove(0);
        }
        self.past.push(inverse);
        self.future.clear();
        self.change_counter += 1;
        Ok(())
    }

    pub fn undo(&mut self) -> Result<bool, ModelError> {
        let Some(inverse) = self.past.pop() else {
            return Ok(false);
        };
        let redo_cmd = self.apply_and_invert(&inverse)?;
        self.future.push(redo_cmd);
        self.change_counter += 1;
        Ok(true)
    }

    pub fn redo(&mut self) -> Result<bool, ModelError> {
        let Some(cmd) = self.future.pop() else {
            return Ok(false);
        };
        let undo_cmd = self.apply_and_invert(&cmd)?;
        self.past.push(undo_cmd);
        self.change_counter += 1;
        Ok(true)
    }

    fn apply_and_invert(&mut self, cmd: &Command) -> Result<Command, ModelError> {
        match cmd {
            Command::AddElements { elements } => {
                let mut ids = Vec::with_capacity(elements.len());
                for el in elements {
                    ids.push(el.id().to_string());
                    self.snapshot.elements.push(el.clone());
                }
                Ok(Command::RemoveElements { ids })
            }
            Command::RemoveElements { ids } => {
                let mut removed = Vec::new();
                self.snapshot.elements.retain(|el| {
                    if ids.iter().any(|id| id == el.id()) {
                        removed.push(el.clone());
                        false
                    } else {
                        true
                    }
                });
                self.snapshot
                    .selected_element_ids
                    .retain(|sid| !ids.iter().any(|id| id == sid));
                Ok(Command::AddElements { elements: removed })
            }
            Command::ReplaceElement { id, next } => {
                let slot = self
                    .snapshot
                    .elements
                    .iter_mut()
                    .find(|el| el.id() == id)
                    .ok_or_else(|| ModelError::ElementNotFound(id.clone()))?;
                let prev = slot.clone();
                *slot = next.clone();
                Ok(Command::ReplaceElement {
                    id: id.clone(),
                    next: prev,
                })
            }
            Command::TransformElements { updates } => {
                let mut prev_updates = Vec::with_capacity(updates.len());
                for upd in updates {
                    let el = self
                        .snapshot
                        .elements
                        .iter_mut()
                        .find(|e| e.id() == upd.id)
                        .ok_or_else(|| ModelError::ElementNotFound(upd.id.clone()))?;
                    let b = el.base_mut();
                    prev_updates.push(ElementGeometryUpdate {
                        id: b.id.clone(),
                        rect: RectBox {
                            x: b.x,
                            y: b.y,
                            width: b.width,
                            height: b.height,
                        },
                        rotation: b.rotation,
                        opacity: b.opacity,
                        z_index: b.z_index,
                    });
                    b.x = upd.rect.x;
                    b.y = upd.rect.y;
                    b.width = upd.rect.width;
                    b.height = upd.rect.height;
                    b.rotation = upd.rotation;
                    b.opacity = upd.opacity;
                    b.z_index = upd.z_index;
                }
                Ok(Command::TransformElements {
                    updates: prev_updates,
                })
            }
            Command::SetPages { pages } => {
                let prev = self.snapshot.pages.clone();
                self.snapshot.pages = pages.clone();
                Ok(Command::SetPages { pages: prev })
            }
            Command::RotatePages {
                page_ids,
                delta_deg,
            } => {
                for p in &mut self.snapshot.pages {
                    if page_ids.iter().any(|id| id == &p.id) {
                        let norm = ((p.user_rotation as i32 + delta_deg).rem_euclid(360)) as u16;
                        p.user_rotation = norm;
                    }
                }
                Ok(Command::RotatePages {
                    page_ids: page_ids.clone(),
                    delta_deg: -delta_deg,
                })
            }
            Command::SetPageNumbering { config } => {
                let prev = self.snapshot.page_numbering.clone();
                self.snapshot.page_numbering = config.clone();
                Ok(Command::SetPageNumbering { config: prev })
            }
            Command::Batch { commands } => {
                let mut inv = Vec::with_capacity(commands.len());
                for c in commands {
                    inv.push(self.apply_and_invert(c)?);
                }
                inv.reverse();
                Ok(Command::Batch { commands: inv })
            }
        }
    }
}
