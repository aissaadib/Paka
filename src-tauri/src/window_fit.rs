//! Keeping the initial window inside the usable work area.
//!
//! The window is configured with a logical size of 1440x900. On a display
//! scaled to 125 % the work area is often only 816 logical pixels tall, so a
//! 900-logical-pixel window cannot fit: the window is taller than the work
//! area and the bottom strip - the status bar - sits underneath the taskbar.
//! At 100 % the same window fits, which is why the defect only shows up on a
//! scaled display.
//!
//! The fix is a sizing fix, not a scaling fix: at startup the outer window is
//! clamped to the work area of the monitor it is on. A window that already
//! fits is left exactly as configured. All the arithmetic here is in physical
//! pixels, which is the unit `Monitor::work_area` and the window geometry
//! APIs use, so no DPI conversion is involved and none can be got wrong.
//!
//! The geometry is a pure function so it can be tested without a window.

use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

/// A width and a height, in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Size {
    pub width: u32,
    pub height: u32,
}

/// A position, in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

/// A rectangle, in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub position: Point,
    pub size: Size,
}

/// Where the window should end up.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Placement {
    /// The requested inner (client) size.
    pub inner: Size,
    /// The requested outer (window) position.
    pub position: Point,
}

/// Fits a window into `work`, never growing it.
///
/// `inner` is the current inner size, `frame` the difference between the outer
/// and inner size (the title bar and borders), `position` the current outer
/// position, and `work` the monitor's usable work area - the screen minus the
/// taskbar and any other reserved edges.
///
/// The result's outer rectangle fits inside `work` wherever the work area is
/// large enough to hold the window frame at all. When it is not, the inner size
/// collapses to one pixel and the window is pinned to the work area's origin
/// rather than being placed at a negative coordinate or panicking.
pub fn fit_within_work_area(
    inner: Size,
    frame: Size,
    position: Point,
    work: Rect,
) -> Placement {
    // The largest inner size whose outer rectangle still fits.
    let max_inner = Size {
        width: work.size.width.saturating_sub(frame.width).max(1),
        height: work.size.height.saturating_sub(frame.height).max(1),
    };
    let fitted_inner = Size {
        width: inner.width.min(max_inner.width).max(1),
        height: inner.height.min(max_inner.height).max(1),
    };
    let outer = Size {
        width: fitted_inner.width.saturating_add(frame.width),
        height: fitted_inner.height.saturating_add(frame.height),
    };

    Placement {
        inner: fitted_inner,
        position: Point {
            x: clamp_axis(position.x, work.position.x, work.size.width, outer.width),
            y: clamp_axis(position.y, work.position.y, work.size.height, outer.height),
        },
    }
}

/// Clamps one window axis into `[origin, origin + span - extent]`.
///
/// The arithmetic is widened to `i64`: monitor origins can be negative, and a
/// window on a monitor to the left of the primary one legitimately has negative
/// coordinates.
fn clamp_axis(value: i32, origin: i32, span: u32, extent: u32) -> i32 {
    let lowest = i64::from(origin);
    let highest = (lowest + i64::from(span) - i64::from(extent)).max(lowest);
    (i64::from(value)).clamp(lowest, highest) as i32
}

/// Applies the fit to a real window, using the monitor it is currently on.
///
/// Returns the placement that was applied, or `None` when no monitor is known
/// yet (which can happen while the window is still being created) - in that
/// case the window is left alone.
pub fn fit_window_to_work_area(window: &WebviewWindow) -> tauri::Result<Option<Placement>> {
    let Some(monitor) = window.current_monitor()? else {
        return Ok(None);
    };

    let inner = window.inner_size()?;
    let outer = window.outer_size()?;
    let position = window.outer_position()?;
    let work = monitor.work_area();

    let placement = fit_within_work_area(
        Size {
            width: inner.width,
            height: inner.height,
        },
        Size {
            width: outer.width.saturating_sub(inner.width),
            height: outer.height.saturating_sub(inner.height),
        },
        Point {
            x: position.x,
            y: position.y,
        },
        Rect {
            position: Point {
                x: work.position.x,
                y: work.position.y,
            },
            size: Size {
                width: work.size.width,
                height: work.size.height,
            },
        },
    );

    let current = Placement {
        inner: Size {
            width: inner.width,
            height: inner.height,
        },
        position: Point {
            x: position.x,
            y: position.y,
        },
    };

    if placement.inner != current.inner {
        window.set_size(PhysicalSize::new(
            placement.inner.width,
            placement.inner.height,
        ))?;
    }
    if placement.position != current.position {
        window.set_position(PhysicalPosition::new(
            placement.position.x,
            placement.position.y,
        ))?;
    }

    Ok(Some(placement))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect {
            position: Point { x, y },
            size: Size { width, height },
        }
    }

    fn size(width: u32, height: u32) -> Size {
        Size { width, height }
    }

    fn point(x: i32, y: i32) -> Point {
        Point { x, y }
    }

    /// A 1920x1080 monitor whose taskbar leaves 1920x1020, at 100 %.
    fn work_100() -> Rect {
        rect(0, 0, 1920, 1020)
    }

    /// The same monitor at 125 %: the logical work area is 1536x816, the
    /// window frame is 18 px wide and 47 px tall in physical pixels, and the
    /// 1440x900 logical default is 1800x1055 physical.
    fn at_125_percent() -> (Size, Size, Point) {
        (size(1800, 1055), size(18, 47), point(102, 0))
    }

    #[test]
    fn leaves_a_window_that_fits_alone() {
        let (inner, frame, position) = at_125_percent();
        let placement = fit_within_work_area(inner, frame, position, rect(0, 0, 1920, 1080));

        assert_eq!(placement.inner, inner);
        assert_eq!(placement.position, position);
    }

    #[test]
    fn leaves_a_smaller_window_alone_and_never_grows_it() {
        let placement = fit_within_work_area(
            size(800, 500),
            size(18, 47),
            point(40, 40),
            work_100(),
        );

        assert_eq!(placement.inner, size(800, 500));
        assert_eq!(placement.position, point(40, 40));
    }

    #[test]
    fn shrinks_the_default_window_to_the_work_area_at_125_percent() {
        let (inner, frame, position) = at_125_percent();
        let placement = fit_within_work_area(inner, frame, position, work_100());

        // 1020 - 47 pixels of frame.
        assert_eq!(placement.inner, size(1800, 973));
        // Already inside horizontally: 102 + 1818 = 1920.
        assert_eq!(placement.position, position);
    }

    #[test]
    fn moves_a_window_that_would_hang_off_the_right_edge() {
        let placement =
            fit_within_work_area(size(1200, 800), size(18, 47), point(900, 10), work_100());

        // 1218 wide, so the leftmost legal x is 1920 - 1218.
        assert_eq!(placement.position, point(702, 10));
        assert_eq!(placement.inner, size(1200, 800));
    }

    #[test]
    fn moves_a_window_that_would_hang_off_the_bottom_edge() {
        let placement =
            fit_within_work_area(size(1200, 900), size(18, 47), point(10, 200), work_100());

        // 947 tall, so the highest legal y is 1020 - 947.
        assert_eq!(placement.position, point(10, 73));
        assert_eq!(placement.inner, size(1200, 900));
    }

    #[test]
    fn keeps_a_window_on_a_monitor_left_of_the_primary_one() {
        let secondary = rect(-1920, 0, 1920, 1020);
        let placement =
            fit_within_work_area(size(1800, 1055), size(18, 47), point(-1818, 0), secondary);

        assert_eq!(placement.inner, size(1800, 973));
        // Pinned to the secondary monitor, not dragged onto the primary one.
        assert_eq!(placement.position, point(-1818, 0));
    }

    #[test]
    fn moves_a_window_onto_the_monitor_its_work_area_belongs_to() {
        let secondary = rect(1920, 0, 1920, 1020);
        let placement =
            fit_within_work_area(size(800, 600), size(18, 47), point(1900, 30), secondary);

        assert_eq!(placement.position, point(1920, 30));
        assert_eq!(placement.inner, size(800, 600));
    }

    #[test]
    fn does_not_panic_when_the_work_area_is_smaller_than_the_frame() {
        let placement =
            fit_within_work_area(size(800, 600), size(100, 200), point(5, 5), rect(0, 0, 80, 150));

        assert_eq!(placement.inner, size(1, 1));
        assert_eq!(placement.position, point(0, 0));
    }
}
