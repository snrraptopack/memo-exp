use std::fmt;

#[derive(Debug, Eq, PartialEq)]
pub enum DocumentError {
    InvalidTemplate {
        source: Option<usize>,
        reason: &'static str,
    },
    InvalidOwner,
    DuplicateOwner,
    StaleGeneration,
    UnknownOwner,
    UnknownSource,
    WrongNodeKind,
    MissingEngineNode,
    DetachedRegion,
    InvalidRange,
    DifferentTarget,
    FailedDocument,
    ApplicationFailed,
}

impl fmt::Display for DocumentError {
    fn fmt(&self, output: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidTemplate { source, reason } => {
                write!(output, "desktop template at source {source:?}: {reason}")
            }
            Self::InvalidOwner => write!(
                output,
                "desktop owner requires an ID and positive generation"
            ),
            Self::DuplicateOwner => write!(output, "desktop owner already has a live instance"),
            Self::StaleGeneration => {
                write!(output, "desktop owner generation has already been used")
            }
            Self::UnknownOwner => write!(output, "desktop owner generation is not live"),
            Self::UnknownSource => write!(output, "desktop source index is outside its template"),
            Self::WrongNodeKind => write!(
                output,
                "desktop operation requires a different source node kind"
            ),
            Self::MissingEngineNode => {
                write!(output, "desktop source no longer has its engine allocation")
            }
            Self::DetachedRegion => write!(output, "desktop region anchor has no live parent"),
            Self::InvalidRange => write!(
                output,
                "desktop instance boundaries are not a contiguous sibling range"
            ),
            Self::DifferentTarget => write!(
                output,
                "desktop instance move crosses its owning destination"
            ),
            Self::FailedDocument => write!(
                output,
                "desktop document failed and cannot accept further work"
            ),
            Self::ApplicationFailed => write!(
                output,
                "desktop live application failed; acceptance is unknown"
            ),
        }
    }
}

impl std::error::Error for DocumentError {}
