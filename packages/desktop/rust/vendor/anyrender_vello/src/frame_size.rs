//! Coalesce physical resize notifications at the frame boundary. A minimized
//! surface stays suspended until a later nonzero notification restores it.

#[derive(Default)]
pub(crate) struct FrameSize {
    latest: Option<(u32, u32)>,
}

#[derive(Debug, PartialEq)]
pub(crate) enum SizeDecision {
    Skip,
    Keep,
    Resize(u32, u32),
}

impl FrameSize {
    pub(crate) fn update(&mut self, width: u32, height: u32) {
        self.latest = Some((width, height));
    }

    pub(crate) fn before_frame(&mut self, current: (u32, u32)) -> SizeDecision {
        match self.latest {
            Some((0, _)) | Some((_, 0)) => SizeDecision::Skip,
            Some(size) => {
                self.latest = None;
                if size == current {
                    SizeDecision::Keep
                } else {
                    SizeDecision::Resize(size.0, size.1)
                }
            }
            None => SizeDecision::Keep,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{FrameSize, SizeDecision};

    #[test]
    fn a_drag_applies_only_the_latest_size_at_the_frame_boundary() {
        let mut size = FrameSize::default();
        for width in 600..900 {
            size.update(width, 500);
        }
        assert_eq!(
            size.before_frame((600, 500)),
            SizeDecision::Resize(899, 500)
        );
        assert_eq!(size.before_frame((899, 500)), SizeDecision::Keep);
        size.update(899, 500);
        assert_eq!(size.before_frame((899, 500)), SizeDecision::Keep);
    }

    #[test]
    fn minimized_frames_remain_skipped_until_restored() {
        let mut size = FrameSize::default();
        size.update(0, 500);
        assert_eq!(size.before_frame((600, 500)), SizeDecision::Skip);
        assert_eq!(size.before_frame((600, 500)), SizeDecision::Skip);
        size.update(800, 600);
        assert_eq!(
            size.before_frame((600, 500)),
            SizeDecision::Resize(800, 600)
        );
    }
}
