"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSwipeNote, deleteSwipeNote } from "@/app/actions";
import { formatDuration, parseTimestamp } from "@/lib/youtube/core";
import type { SwipeNote } from "@/lib/repo";
import type { ActionState } from "@/lib/action-errors";
import { UpgradePrompt } from "./billing";

interface VideoInfo {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  durationSeconds: number;
  isDemo: boolean;
}

interface PlayerHandle {
  getTime: () => number;
  seek: (s: number) => void;
}

const QUICK_TAGS = ["hook", "question", "pattern interrupt", "story", "payoff", "controversy", "caption idea"];

// ── YouTube IFrame Player API (official embed; no downloading) ─────────────
type YTPlayer = { getCurrentTime(): number; seekTo(s: number, allow: boolean): void; playVideo(): void; destroy(): void };
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve();
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      document.head.appendChild(s);
    });
  }
  return ytApiPromise;
}

function YouTubePlayer({ videoId, onReady }: { videoId: string; onReady: (h: PlayerHandle) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let player: YTPlayer | null = null;
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !ref.current || !window.YT) return;
      player = new window.YT.Player(ref.current, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () =>
            onReady({
              getTime: () => player?.getCurrentTime() ?? 0,
              seek: (s) => {
                player?.seekTo(s, true);
                player?.playVideo();
              },
            }),
        },
      });
    });
    return () => {
      cancelled = true;
      player?.destroy();
    };
  }, [videoId, onReady]);
  return (
    <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black [&>iframe]:h-full [&>iframe]:w-full">
      <div ref={ref} />
    </div>
  );
}

/** Simulated player for DEMO videos (no real YouTube video behind them). */
function DemoPlayer({ duration, onReady }: { duration: number; onReady: (h: PlayerHandle) => void }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(0);
  tRef.current = t;
  useEffect(() => {
    onReady({ getTime: () => tRef.current, seek: (s) => (setT(s), setPlaying(true)) });
  }, [onReady]);
  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => setT((x) => (x + 1 >= duration ? (setPlaying(false), duration) : x + 1)), 1000);
    return () => clearInterval(iv);
  }, [playing, duration]);
  return (
    <div className="flex aspect-video w-full flex-col justify-between overflow-hidden rounded-2xl border border-ink-700 bg-gradient-to-br from-ink-800 via-ink-900 to-black p-4">
      <span className="self-start rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
        Demo player: no real video
      </span>
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-lane-400 text-2xl text-ink-950 hover:bg-lane-500"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-ink-300">{formatDuration(t)}</span>
        <input type="range" min={0} max={duration} value={t} onChange={(e) => setT(Number(e.target.value))} className="flex-1 accent-lane-400" aria-label="Seek" />
        <span className="font-mono text-xs text-ink-400">{formatDuration(duration)}</span>
      </div>
    </div>
  );
}

export function PlayerWithNotes({ video, notes }: { video: VideoInfo; notes: SwipeNote[] }) {
  const router = useRouter();
  const handle = useRef<PlayerHandle | null>(null);
  const [stamp, setStamp] = useState("0:00");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<string[]>(["hook"]);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<NonNullable<ActionState>["upgrade"]>(undefined);
  const [pending, start] = useTransition();
  const onReady = useCallback((h: PlayerHandle) => (handle.current = h), []);

  const grabTime = () => setStamp(formatDuration(Math.floor(handle.current?.getTime() ?? 0)));
  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t].slice(0, 8)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const seconds = parseTimestamp(stamp);
    if (seconds === null) return setError("Timestamp must look like 1:23 or 1:02:03.");
    if (!note.trim()) return setError("Write what makes this moment work.");
    setError(null);
    start(async () => {
      const res = await addSwipeNote({
        videoId: video.id,
        videoTitle: video.title,
        channelId: video.channelId,
        channelTitle: video.channelTitle,
        seconds: Math.min(seconds, Math.max(video.durationSeconds, seconds)),
        note: note.trim(),
        tags,
      });
      if (res.upgrade) return setUpgrade(res.upgrade);
      if (res.error) return setError(res.error);
      setUpgrade(undefined);
      setNote("");
      router.refresh();
    });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div>
        {video.isDemo ? <DemoPlayer duration={video.durationSeconds} onReady={onReady} /> : <YouTubePlayer videoId={video.id} onReady={onReady} />}
      </div>

      <div className="space-y-4">
        <form onSubmit={submit} className="card space-y-3 p-4">
          <p className="text-sm font-semibold">Save a hook note</p>
          <div className="flex gap-2">
            <input value={stamp} onChange={(e) => setStamp(e.target.value)} className="input w-28 font-mono" aria-label="Timestamp" inputMode="numeric" />
            <button type="button" onClick={grabTime} className="btn-secondary flex-1 text-xs">
              Use current time
            </button>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What makes this moment work? e.g. 'Opens mid-argument, guest's reaction at 0:03 is the payoff'"
            className="input resize-y"
            aria-label="Note"
          />
          <div className="flex flex-wrap gap-1.5">
            {QUICK_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleTag(t)}
                className={`chip ${tags.includes(t) ? "border-lane-400 bg-lane-400/10 text-lane-400" : ""}`}
                aria-pressed={tags.includes(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-red-300">{error}</p>}
          {upgrade && <UpgradePrompt upgrade={upgrade} />}
          <button disabled={pending} className="btn-primary w-full">
            {pending ? "Saving…" : "Save to swipe file"}
          </button>
        </form>

        <div className="card p-4">
          <p className="mb-2 text-sm font-semibold">
            Notes on this video <span className="text-ink-400">({notes.length})</span>
          </p>
          {notes.length === 0 ? (
            <p className="text-sm text-ink-400">No notes yet. Pause on a strong moment and save it.</p>
          ) : (
            <ul className="divide-y divide-ink-700">
              {notes.map((n) => (
                <li key={n.id} className="flex gap-3 py-2.5">
                  <button type="button" onClick={() => handle.current?.seek(n.timestamp_seconds)} className="h-fit rounded-md bg-ink-700 px-1.5 py-0.5 font-mono text-xs text-lane-400 hover:bg-ink-600">
                    {formatDuration(n.timestamp_seconds)}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words text-sm">{n.note}</p>
                    {n.tags.length > 0 && <p className="mt-1 text-xs text-ink-400">{n.tags.map((t) => `#${t.replace(/\s+/g, "-")}`).join(" ")}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => start(async () => { await deleteSwipeNote(n.id); router.refresh(); })}
                    className="h-fit text-xs text-ink-400 hover:text-red-300"
                    aria-label="Delete note"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
