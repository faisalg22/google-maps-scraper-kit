import type { Category, Channel, Video } from "../youtube/core";

/**
 * DEMO DATA. Fictional channels and videos used while YOUTUBE_API_KEY is not set.
 * IDs start with "demo-" so the UI shows a simulated player instead of embedding YouTube.
 */

interface ChannelSeed {
  id: string;
  title: string;
  category: Category;
  subscribers: number;
  description: string;
  topics: string[];
}

const channelSeeds: ChannelSeed[] = [
  { id: "demo-ch-latenightmic", title: "Late Night Mic (demo)", category: "podcasts", subscribers: 1_240_000, description: "Comedy podcast with weekly guests.", topics: ["the worst date ever", "quitting my job live", "celebrity roast round", "ranking fast food"] },
  { id: "demo-ch-deepwork", title: "Deep Work Talks (demo)", category: "podcasts", subscribers: 380_000, description: "Long-form conversations about focus and careers.", topics: ["how I read 100 books", "the 4am myth", "burnout recovery", "building a second brain"] },
  { id: "demo-ch-courtside", title: "Courtside Talk (demo)", category: "podcasts", subscribers: 96_000, description: "Basketball debates, three times a week.", topics: ["GOAT debate gets heated", "trade deadline reactions", "worst contracts", "rookie rankings"] },
  { id: "demo-ch-pixelforge", title: "PixelForge (demo)", category: "streamers", subscribers: 2_100_000, description: "Competitive FPS streams and challenges.", topics: ["1v5 clutch for the win", "rage quit compilation", "speedrun world record attempt", "viewer challenge night"] },
  { id: "demo-ch-cozyquest", title: "CozyQuest Live (demo)", category: "streamers", subscribers: 155_000, description: "Chill RPG streams and community events.", topics: ["100 hour farm tour", "boss fight with chat", "first time playing a horror game", "charity marathon"] },
  { id: "demo-ch-lunaeats", title: "Luna Eats (demo)", category: "influencers", subscribers: 870_000, description: "Food and travel vlogs.", topics: ["$1 vs $1000 sushi", "24 hours in Tokyo", "street food challenge", "trying viral recipes"] },
  { id: "demo-ch-hustle", title: "Hustle Diaries (demo)", category: "influencers", subscribers: 450_000, description: "Creator business interviews and advice.", topics: ["from 0 to 1M followers", "my first $10k month", "brand deals explained", "what nobody tells you about fame"] },
  { id: "demo-ch-mindlab", title: "MindLab (demo)", category: "educational", subscribers: 3_400_000, description: "Science explained with animations.", topics: ["why time feels faster as you age", "what's inside a black hole", "the science of sleep", "how memory really works"] },
  { id: "demo-ch-moneysimple", title: "Money Made Simple (demo)", category: "educational", subscribers: 210_000, description: "Personal finance for beginners.", topics: ["investing with $100", "the credit score trap", "budgeting that actually works", "renting vs buying"] },
  { id: "demo-ch-tiny", title: "Tiny Garage Builds (demo)", category: "influencers", subscribers: 31_000, description: "Below the 50k filter on purpose, so the filter is visible in demo mode.", topics: ["restoring a bike"] },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

const channels: (Channel & { category: Category; topics: string[] })[] = channelSeeds.map((s) => ({
  id: s.id,
  title: s.title,
  description: s.description,
  thumbnail: null,
  subscribers: s.subscribers,
  videoCount: 120 + (hash(s.id) % 600),
  viewCount: s.subscribers * (40 + (hash(s.id) % 80)),
  uploadsPlaylistId: null,
  customUrl: null,
  isDemo: true,
  category: s.category,
  topics: s.topics,
}));

export function mockSearchChannels(category: Category, query: string, minSubs: number): Channel[] {
  const qx = query.trim().toLowerCase();
  return channels
    .filter((c) => c.category === category)
    .filter((c) => !qx || `${c.title} ${c.description} ${c.topics.join(" ")}`.toLowerCase().includes(qx))
    .filter((c) => c.subscribers >= minSubs)
    .sort((a, b) => b.subscribers - a.subscribers)
    .map(({ category: _c, topics: _t, ...c }) => c);
}

export function mockChannel(id: string): Channel | null {
  const c = channels.find((x) => x.id === id);
  if (!c) return null;
  const { category: _c, topics: _t, ...rest } = c;
  return rest;
}

export function mockChannelVideos(channelId: string): Video[] {
  const c = channels.find((x) => x.id === channelId);
  if (!c) return [];
  const out: Video[] = [];
  c.topics.forEach((topic, i) => {
    for (let part = 0; part < 2; part++) {
      const id = `demo-${channelId.replace("demo-ch-", "")}-${i}${part}`;
      const h = hash(id);
      const views = Math.round(c.subscribers * (0.05 + (h % 300) / 100));
      out.push({
        id,
        channelId: c.id,
        channelTitle: c.title,
        title: part === 0 ? `${topic[0].toUpperCase()}${topic.slice(1)}` : `${topic[0].toUpperCase()}${topic.slice(1)} (full episode)`,
        thumbnail: null,
        publishedAt: new Date(Date.UTC(2026, 10, 12) - (i * 2 + part) * 4 * 86400_000).toISOString(),
        durationSeconds: 11 * 60 + (h % (100 * 60)),
        views,
        likes: Math.round(views * (0.02 + (h % 30) / 1000)),
        isDemo: true,
      });
    }
  });
  return out;
}

export function mockVideo(id: string): Video | null {
  for (const c of channels) {
    const v = mockChannelVideos(c.id).find((x) => x.id === id);
    if (v) return v;
  }
  return null;
}
