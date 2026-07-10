import React, { useEffect, useMemo, useRef } from "react";

const ROW_HEIGHT = 40;
const VISIBLE_ROWS = 5;
const VIEWPORT_HEIGHT = ROW_HEIGHT * VISIBLE_ROWS;
const PADDING = (VIEWPORT_HEIGHT - ROW_HEIGHT) / 2;
const SETTLE_DEBOUNCE_MS = 130;

const LABEL = "text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block";

/** Convert a 24h "HH:mm" string to 12h parts. */
function to12h(hhmm) {
  const [hStr, mStr] = (hhmm || "09:00").split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h)) h = 9;
  const minute = Number.isNaN(m) ? 0 : m;
  const meridiem = h >= 12 ? "PM" : "AM";
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute, meridiem };
}

/** Convert 12h parts back to a 24h "HH:mm" string. */
function from12h(hour12, minute, meridiem) {
  let h = hour12 % 12;
  if (meridiem === "PM") h += 12;
  const hh = String(h).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${hh}:${mm}`;
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function WheelColumn({ options, valueIndex, onCommit, disabled, ariaLabel }) {
  const scrollRef = useRef(null);
  const isInteractingRef = useRef(false);
  const settleTimerRef = useRef(null);
  const dragStateRef = useRef(null);

  // Keep scroll position synced to external value changes, unless the user
  // is mid-interaction (dragging/scrolling) right now.
  useEffect(() => {
    if (isInteractingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = valueIndex * ROW_HEIGHT;
    if (el.scrollTop !== target) el.scrollTop = target;
  }, [valueIndex, options.length]);

  const commitFromScrollTop = (scrollTop) => {
    const el = scrollRef.current;
    if (!el) return;
    const rawIndex = Math.round(scrollTop / ROW_HEIGHT);
    const index = clamp(rawIndex, 0, options.length - 1);
    el.scrollTop = index * ROW_HEIGHT;
    onCommit(index);
  };

  const scheduleSettle = () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      const el = scrollRef.current;
      isInteractingRef.current = false;
      settleTimerRef.current = null;
      if (el) commitFromScrollTop(el.scrollTop);
    }, SETTLE_DEBOUNCE_MS);
  };

  const handleScroll = () => {
    if (disabled) return;
    isInteractingRef.current = true;
    scheduleSettle();
  };

  const handlePointerDown = (e) => {
    if (disabled) return;
    const el = scrollRef.current;
    if (!el) return;
    isInteractingRef.current = true;
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    el.setPointerCapture(e.pointerId);
    dragStateRef.current = { startY: e.clientY, startScrollTop: el.scrollTop };
  };

  const handlePointerMove = (e) => {
    if (disabled) return;
    const el = scrollRef.current;
    const drag = dragStateRef.current;
    if (!el || !drag) return;
    const delta = e.clientY - drag.startY;
    el.scrollTop = drag.startScrollTop - delta;
  };

  const handlePointerUp = (e) => {
    if (disabled) return;
    const el = scrollRef.current;
    if (el) {
      try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    }
    dragStateRef.current = null;
    scheduleSettle();
  };

  const scrollToIndex = (index, behavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: index * ROW_HEIGHT, behavior });
  };

  const handleKeyDown = (e) => {
    const el = scrollRef.current;
    if (!el) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      isInteractingRef.current = true;
      el.scrollBy({ top: ROW_HEIGHT, behavior: "smooth" });
      scheduleSettle();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      isInteractingRef.current = true;
      el.scrollBy({ top: -ROW_HEIGHT, behavior: "smooth" });
      scheduleSettle();
    } else if (e.key === "Home") {
      e.preventDefault();
      isInteractingRef.current = true;
      scrollToIndex(0);
      scheduleSettle();
    } else if (e.key === "End") {
      e.preventDefault();
      isInteractingRef.current = true;
      scrollToIndex(options.length - 1);
      scheduleSettle();
    }
  };

  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
  }, []);

  const interactionProps = disabled
    ? {}
    : {
      onScroll: handleScroll,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
      onKeyDown: handleKeyDown,
    };

  return (
    <div
      ref={scrollRef}
      role="listbox"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      {...interactionProps}
      className="relative w-14 overflow-y-scroll touch-none select-none focus:outline-none [&::-webkit-scrollbar]:hidden"
      style={{ height: VIEWPORT_HEIGHT, scrollSnapType: "y mandatory", scrollbarWidth: "none", msOverflowStyle: "none" }}
    >
      <div style={{ height: PADDING }} aria-hidden="true" />
      {options.map((opt, i) => {
        const selected = i === valueIndex;
        return (
          <div
            key={opt}
            role="option"
            aria-selected={selected}
            onClick={() => !disabled && scrollToIndex(i)}
            className={`flex items-center justify-center text-sm font-semibold transition-colors ${disabled ? "" : "cursor-pointer"} ${
              selected ? "text-indigo-700" : "text-slate-400"
            }`}
            style={{ height: ROW_HEIGHT, scrollSnapAlign: "center" }}
          >
            {opt}
          </div>
        );
      })}
      <div style={{ height: PADDING }} aria-hidden="true" />
    </div>
  );
}

export default function TimeWheelPicker({ value, onChange, minuteStep = 1, disabled = false, label }) {
  const { hour12, minute, meridiem } = useMemo(() => to12h(value), [value]);

  const hourOptions = useMemo(
    () => Array.from({ length: 12 }, (_, i) => String(i + 1)),
    []
  );
  const minuteOptions = useMemo(() => {
    const step = minuteStep > 1 ? minuteStep : 1;
    const opts = [];
    for (let m = 0; m < 60; m += step) opts.push(String(m).padStart(2, "0"));
    return opts;
  }, [minuteStep]);
  const meridiemOptions = useMemo(() => ["AM", "PM"], []);

  const hourIndex = clamp(hour12 - 1, 0, hourOptions.length - 1);
  const minuteIndex = useMemo(() => {
    const step = minuteStep > 1 ? minuteStep : 1;
    const snapped = Math.round(minute / step) * step;
    const idx = Math.floor(snapped / step);
    return clamp(idx, 0, minuteOptions.length - 1);
  }, [minute, minuteStep, minuteOptions.length]);
  const meridiemIndex = meridiem === "PM" ? 1 : 0;

  const commitHour = (index) => {
    const nextHour12 = index + 1;
    onChange(from12h(nextHour12, minute, meridiem));
  };
  const commitMinute = (index) => {
    const step = minuteStep > 1 ? minuteStep : 1;
    const nextMinute = clamp(index * step, 0, 59);
    onChange(from12h(hour12, nextMinute, meridiem));
  };
  const commitMeridiem = (index) => {
    const nextMeridiem = index === 1 ? "PM" : "AM";
    onChange(from12h(hour12, minute, nextMeridiem));
  };

  return (
    <div className={disabled ? "opacity-50" : ""}>
      {label && <label className={LABEL}>{label}</label>}
      <div
        className="relative inline-flex items-stretch gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1"
        style={{ pointerEvents: disabled ? "none" : "auto" }}
      >
        <div
          className="pointer-events-none absolute left-2 right-2 bg-slate-100 rounded-md"
          style={{ top: PADDING, height: ROW_HEIGHT }}
          aria-hidden="true"
        />
        <WheelColumn options={hourOptions} valueIndex={hourIndex} onCommit={commitHour} disabled={disabled} ariaLabel="Hour" />
        <div className="flex items-center justify-center text-sm font-semibold text-slate-400" style={{ height: VIEWPORT_HEIGHT }}>:</div>
        <WheelColumn options={minuteOptions} valueIndex={minuteIndex} onCommit={commitMinute} disabled={disabled} ariaLabel="Minute" />
        <WheelColumn options={meridiemOptions} valueIndex={meridiemIndex} onCommit={commitMeridiem} disabled={disabled} ariaLabel="AM/PM" />
      </div>
    </div>
  );
}
