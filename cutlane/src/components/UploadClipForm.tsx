"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClip, requestClipUpload } from "@/app/actions";

const MAX = 1024 * 1024 * 1024;

function putWithProgress(url: string, file: File, headers: Record<string, string>, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (HTTP ${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export function UploadClipForm({ campaigns, defaultCampaignId }: { campaigns: { id: string; title: string }[]; defaultCampaignId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ w: number; h: number; d: number } | null>(null);
  const [title, setTitle] = useState("");
  const [campaignId, setCampaignId] = useState(campaigns.some((c) => c.id === defaultCampaignId) ? defaultCampaignId : "");
  const [rights, setRights] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const pick = (f: File | null) => {
    setError(null);
    setMeta(null);
    if (!f) return setFile(null);
    if (f.type !== "video/mp4") return setError("Only MP4 files are supported.");
    if (f.size > MAX) return setError("Clips must be 1 GB or smaller.");
    setFile(f);
    setPreview(URL.createObjectURL(f));
    if (!title) setTitle(f.name.replace(/\.mp4$/i, "").replace(/[_-]+/g, " ").slice(0, 200));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setError("Choose an MP4 file.");
    if (!title.trim()) return setError("Give the clip a title.");
    if (!rights) return setError("Confirm the footage rights.");
    setError(null);
    try {
      setProgress(0);
      const { key, target } = await requestClipUpload({ fileName: file.name, size: file.size, mime: "video/mp4" });
      await putWithProgress(target.url, file, target.headers, setProgress);
      const campaign = campaigns.find((c) => c.id === campaignId);
      const res = await createClip({
        key,
        title: title.trim(),
        fileName: file.name,
        campaignId: campaign?.id ?? null,
        campaignTitle: campaign?.title ?? null,
        rightsConfirmed: true,
      });
      if (res.error || !res.id) throw new Error(res.error ?? "Could not save the clip.");
      router.push(`/clips/${res.id}`);
    } catch (err) {
      setProgress(null);
      setError((err as Error).message);
    }
  };

  const warnings: string[] = [];
  if (meta) {
    if (meta.w >= meta.h) warnings.push("This clip isn't vertical. Reels, TikTok and Shorts expect 9:16.");
    if (meta.d > 180) warnings.push("Longer than 3 minutes: too long for YouTube Shorts.");
  }

  return (
    <form onSubmit={submit} className="card space-y-5 p-5">
      <div>
        <label className="label" htmlFor="file">Clip file (MP4)</label>
        <label htmlFor="file" className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-ink-600 bg-ink-900 px-4 py-8 text-center hover:border-lane-400/60">
          <span className="text-sm font-medium">{file ? file.name : "Tap to choose an MP4"}</span>
          <span className="mt-1 text-xs text-ink-400">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "Up to 1 GB"}</span>
        </label>
        <input id="file" type="file" accept="video/mp4" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </div>

      {preview && (
        <div className="flex gap-4">
          <video
            src={preview}
            className="aspect-[9/16] w-28 rounded-lg bg-black object-contain"
            muted
            playsInline
            controls
            onLoadedMetadata={(e) => setMeta({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight, d: e.currentTarget.duration })}
          />
          <div className="text-xs text-ink-400">
            {meta && (
              <p>
                {meta.w}×{meta.h} · {Math.round(meta.d)}s
              </p>
            )}
            {warnings.map((w) => (
              <p key={w} className="mt-1 text-amber-300">{w}</p>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="label" htmlFor="title">Title</label>
        <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="input" placeholder="e.g. Guest reacts to the worst date story" />
      </div>

      <div>
        <label className="label" htmlFor="campaign">Campaign</label>
        <select id="campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="input">
          <option value="">Not linked yet</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-400">You need a linked campaign to submit to Whop.</p>
      </div>

      <label className="flex gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3 text-sm">
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5 h-4 w-4 accent-lane-400" />
        <span>I made this clip from the campaign&apos;s provided content or with the creator&apos;s permission.</span>
      </label>

      {error && <p className="text-sm text-red-300" role="alert">{error}</p>}

      {progress !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-ink-800" aria-label="Upload progress">
          <div className="h-full bg-lane-400 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      <button disabled={progress !== null} className="btn-primary w-full">
        {progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : "Upload clip"}
      </button>
    </form>
  );
}
