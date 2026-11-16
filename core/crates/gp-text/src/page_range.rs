use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedRangeGroup {
    pub label: String,
    pub page_indices: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRangeParseResult {
    pub groups: Vec<ParsedRangeGroup>,
    pub all_indices: Vec<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn parse_page_range_expression(input: &str, total_pages: usize) -> PageRangeParseResult {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return PageRangeParseResult {
            groups: Vec::new(),
            all_indices: Vec::new(),
            error: Some("Enter at least one page number or range.".to_string()),
        };
    }
    if total_pages == 0 {
        return PageRangeParseResult {
            groups: Vec::new(),
            all_indices: Vec::new(),
            error: Some("Document has no pages.".to_string()),
        };
    }

    let tokens: Vec<&str> = trimmed
        .split(',')
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() {
        return PageRangeParseResult {
            groups: Vec::new(),
            all_indices: Vec::new(),
            error: Some("Invalid page range syntax.".to_string()),
        };
    }

    let mut groups = Vec::with_capacity(tokens.len());
    let mut seen = HashSet::new();
    let mut all_indices = Vec::new();

    for token in tokens {
        let parts: Vec<&str> = token.split('-').map(|s| s.trim()).collect();
        if parts.len() > 2 || parts.iter().any(|s| s.is_empty() || !s.chars().all(|c| c.is_ascii_digit())) {
            return PageRangeParseResult {
                groups: Vec::new(),
                all_indices: Vec::new(),
                error: Some(format!("Invalid range token \"{token}\". Use formats like \"1-3, 5\".")),
            };
        }
        let Ok(start) = parts[0].parse::<usize>() else {
            return PageRangeParseResult {
                groups: Vec::new(),
                all_indices: Vec::new(),
                error: Some(format!("Invalid range token \"{token}\". Use formats like \"1-3, 5\".")),
            };
        };
        let has_dash = parts.len() == 2;
        let end = if has_dash {
            let Ok(v) = parts[1].parse::<usize>() else {
                return PageRangeParseResult {
                    groups: Vec::new(),
                    all_indices: Vec::new(),
                    error: Some(format!("Invalid range token \"{token}\". Use formats like \"1-3, 5\".")),
                };
            };
            v
        } else {
            start
        };

        if start < 1 || end < 1 || start > total_pages || end > total_pages {
            return PageRangeParseResult {
                groups: Vec::new(),
                all_indices: Vec::new(),
                error: Some(format!("Page numbers must be between 1 and {total_pages}.")),
            };
        }

        let mut group_indices = Vec::new();
        if start <= end {
            for p in start..=end {
                let z = p - 1;
                group_indices.push(z);
                if seen.insert(z) {
                    all_indices.push(z);
                }
            }
        } else {
            for p in (end..=start).rev() {
                let z = p - 1;
                group_indices.push(z);
                if seen.insert(z) {
                    all_indices.push(z);
                }
            }
        }

        groups.push(ParsedRangeGroup {
            label: if has_dash {
                format!("{start}-{end}")
            } else {
                format!("{start}")
            },
            page_indices: group_indices,
        });
    }

    PageRangeParseResult {
        groups,
        all_indices,
        error: None,
    }
}
