import pkg from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = pkg;

// ─── Config ───────────────────────────────────────────────────────────────────
const TMDB_API_KEY   = process.env.TMDB_API_KEY || "";
const TMDB_BASE      = "https://api.themoviedb.org/3";
const STREAMED_BASE  = "https://streamed.pk";

// Browser-like headers for scraping embed pages
const SCRAPE_HEADERS = {
    "User-Agent"     : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept"         : "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer"        : "https://streamed.pk/",
};

// ─── Manifest ─────────────────────────────────────────────────────────────────
const manifest = {
    id         : "community.nuvio.westernanimation",
    version    : "2.0.0",
    name       : "Animation & Live Sports",
    description: "Hollywood & Western animation movies + Live sports streaming via streamed.pk. Explore Pixar, DreamWorks, Disney — and watch live football, cricket, basketball & more.",
    resources  : ["catalog", "meta", "stream"],
    types      : ["movie", "channel"],
    catalogs   : [
        // ── Animation ────────────────────────────────────────────────────────
        {
            type : "movie", id: "animation_trending",
            name : "🎬 Trending Animation",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type : "movie", id: "animation_top_rated",
            name : "⭐ Top Rated Animation",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type : "movie", id: "animation_pixar",
            name : "✨ Pixar Collection",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type : "movie", id: "animation_dreamworks",
            name : "🐉 DreamWorks Classics",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type : "movie", id: "animation_illumination",
            name : "🎪 Illumination Hits",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type : "movie", id: "animation_disney",
            name : "🏰 Walt Disney",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type : "movie", id: "animation_action",
            name : "💥 Action & Adventure",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type : "movie", id: "animation_golden_age",
            name : "🕹️ 90s & 2000s",
            extra: [{ name: "skip", isRequired: false }]
        },

        // ── Live Sports ───────────────────────────────────────────────────────
        { type: "channel", id: "sports_live",       name: "🔴 Live Now"         },
        { type: "channel", id: "sports_today",      name: "📅 Today's Matches"  },
        { type: "channel", id: "sports_popular",    name: "🔥 Popular Matches"  },
        { type: "channel", id: "sports_football",   name: "⚽ Football"         },
        { type: "channel", id: "sports_basketball", name: "🏀 Basketball"       },
        { type: "channel", id: "sports_cricket",    name: "🏏 Cricket"          },
        { type: "channel", id: "sports_tennis",     name: "🎾 Tennis"           },
        { type: "channel", id: "sports_baseball",   name: "⚾ Baseball"         },
        { type: "channel", id: "sports_mma",        name: "🥊 MMA / UFC"        },
        { type: "channel", id: "sports_all",        name: "🏆 All Sports"       },
    ],
    behaviorHints: {
        configurable        : false,
        newEpisodeNotifications: false,
    },
};

// ─── Streamed.pk Helpers ──────────────────────────────────────────────────────

/** Map catalog id → streamed.pk API path */
const SPORT_CATALOG_MAP = {
    sports_live      : "/api/matches/live",
    sports_today     : "/api/matches/all-today",
    sports_popular   : "/api/matches/all/popular",
    sports_football  : "/api/matches/football",
    sports_basketball: "/api/matches/basketball",
    sports_cricket   : "/api/matches/cricket",
    sports_tennis    : "/api/matches/tennis",
    sports_baseball  : "/api/matches/baseball",
    sports_mma       : "/api/matches/mma",
    sports_all       : "/api/matches/all",
};

/** Convert a streamed.pk match object → Stremio channel meta */
function matchToMeta(match) {
    const home = match.teams?.home?.name || "";
    const away = match.teams?.away?.name || "";
    const timeStr = new Date(match.date).toLocaleString("en-US", {
        month: "short", day: "numeric",
        hour : "2-digit", minute: "2-digit",
    });

    const lines = [];
    if (home && away) lines.push(`${home} vs ${away}`);
    lines.push(`📂 ${match.category.toUpperCase()}`);
    lines.push(`🕐 ${timeStr}`);
    if (match.popular) lines.push("⭐ Popular match");

    const posterUrl = match.poster
        ? `${STREAMED_BASE}/api/images/poster/${match.poster}`
        : null;

    const badgeUrl = match.teams?.home?.badge
        ? `${STREAMED_BASE}/api/images/badge/${match.teams.home.badge}`
        : null;

    return {
        id         : `streamed:${match.id}`,
        type       : "channel",
        name       : match.title,
        poster     : posterUrl,
        background : badgeUrl,
        description: lines.join("\n"),
        releaseInfo: timeStr,
        genres     : [match.category],
    };
}

/**
 * Attempt to discover the direct HLS .m3u8 URL for an embed.st stream.
 *
 * embed.st uses a heavily obfuscated JS bundle to load the stream, so we
 * cannot scrape the .m3u8 from the HTML directly. Instead, we:
 *  1. Try known CDN URL patterns that embed.st uses internally
 *  2. Try fetching the embed page and scanning for any leaked URLs
 *
 * Returns an array of candidate .m3u8 URLs (may be empty).
 */
async function discoverM3U8(source, streamId, streamNo) {
    const found = new Set();

    // ── Strategy 1: Try well-known streamed.pk / embed.st CDN patterns ────────
    // These patterns have been observed in the wild for this service.
    // The server names follow a pattern like: {source}{streamNo}.{cdnDomain}
    const cdnPatterns = [
        `https://${source}${streamNo}.streamed.su/hls/${streamId}/index.m3u8`,
        `https://${source}${streamNo}.streamed.pk/hls/${streamId}/index.m3u8`,
        `https://stream.${source}.streamed.su/${streamId}/${streamNo}/index.m3u8`,
        `https://cdn.streamed.pk/${source}/${streamId}/${streamNo}/playlist.m3u8`,
    ];

    for (const url of cdnPatterns) {
        try {
            const r = await fetch(url, {
                method: "HEAD",
                headers: SCRAPE_HEADERS,
                signal: AbortSignal.timeout(3000),
            });
            if (r.ok || r.status === 403) {
                // 403 means exists but geo-blocked — still a valid URL for the client
                found.add(url);
                break;
            }
        } catch (_) {
            // try next
        }
    }

    // ── Strategy 2: Scrape the embed page for any .m3u8 URLs ─────────────────
    // The embed HTML itself won't have the URL (it's loaded by obfuscated JS),
    // but we try anyway in case the site structure changes.
    if (found.size === 0) {
        try {
            const embedUrl = `https://embed.st/embed/${source}/${streamId}/${streamNo}`;
            const res = await fetch(embedUrl, {
                headers: SCRAPE_HEADERS,
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
                const html = await res.text();
                const re = /['"`](https?:\/\/[^'"`<>\s]+?\.m3u8(?:\?[^'"`<>\s]*)?)['"` ]/g;
                let m;
                while ((m = re.exec(html)) !== null) {
                    if (m[1].length > 20) found.add(m[1]);
                }
            }
        } catch (_) { /* ignore */ }
    }

    return [...found];
}

/**
 * Fetch all stream objects for a given match from the Streamed API,
 * attempt to find direct .m3u8 URLs, and always provide embed URLs as fallback.
 *
 * Returns Stremio-compatible stream objects.
 */
async function getStreamsForMatch(match) {
    if (!match?.sources?.length) return [];

    const stremioStreams = [];

    // Fetch streams for all sources in parallel
    const sourceResults = await Promise.allSettled(
        match.sources.map(async (src) => {
            const url = `${STREAMED_BASE}/api/stream/${src.source}/${src.id}`;
            const res = await fetch(url, { headers: { "Referer": STREAMED_BASE } });
            if (!res.ok) return [];
            const streamList = await res.json();
            return streamList.map(s => ({ ...s, _sourceKey: src.source, _matchId: src.id }));
        })
    );

    // Flatten all stream objects
    const allStreams = [];
    for (const result of sourceResults) {
        if (result.status === "fulfilled") {
            allStreams.push(...result.value);
        }
    }

    if (allStreams.length === 0) {
        console.warn(`[stream] No stream objects returned from API for match: ${match.id}`);
        return [];
    }

    // For each stream: try to discover the .m3u8, always add embed as fallback
    const streamResults = await Promise.allSettled(
        allStreams.map(async (stream) => {
            const source  = stream._sourceKey;
            const matchId = stream._matchId;
            const streamNo = stream.streamNo;
            const quality  = stream.hd ? "HD" : "SD";
            const lang     = stream.language || "EN";
            const viewers  = stream.viewers ? ` · 👁 ${stream.viewers}` : "";
            const label    = `${source.toUpperCase()} ${quality} · ${lang}${viewers}`;
            const embedUrl = stream.embedUrl;

            const results = [];

            // Try to find direct .m3u8 (may succeed or return empty)
            const m3u8Urls = await discoverM3U8(source, matchId, streamNo);
            for (const [idx, url] of m3u8Urls.entries()) {
                results.push({
                    name : `🔴 ${label}${m3u8Urls.length > 1 ? ` [${idx + 1}]` : ""}`,
                    title: `${match.title}\n${label} — Direct HLS`,
                    url,
                    behaviorHints: { notWebReady: false },
                });
            }

            // Always add the embed URL as a reliable browser fallback
            results.push({
                name       : `🌐 ${label}`,
                title      : `${match.title}\n${label} — Open in browser`,
                externalUrl: embedUrl,
            });

            return results;
        })
    );

    for (const result of streamResults) {
        if (result.status === "fulfilled") {
            stremioStreams.push(...result.value);
        }
    }

    return stremioStreams;
}

/**
 * Fetch a match object by its streamed.pk ID.
 * Tries live → today → all to minimise response size.
 */
async function findMatchById(matchId) {
    const endpoints = [
        "/api/matches/live",
        "/api/matches/all-today",
        "/api/matches/all",
    ];

    for (const path of endpoints) {
        try {
            const res = await fetch(`${STREAMED_BASE}${path}`);
            if (!res.ok) continue;
            const list = await res.json();
            const found = list.find(m => m.id === matchId);
            if (found) return found;
        } catch (_) {
            // try next
        }
    }
    return null;
}

// ─── Builder ──────────────────────────────────────────────────────────────────
const builder = new addonBuilder(manifest);

// ── Catalog Handler ───────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id, extra }) => {

    // ── Movie catalogs (animation) ────────────────────────────────────────────
    if (type === "movie") {
        const page = extra?.skip ? Math.floor(extra.skip / 20) + 1 : 1;
        let url = `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&with_original_language=en&page=${page}`;
        let genres = ["16"]; // Animation genre

        switch (id) {
            case "animation_trending":
                url += "&sort_by=popularity.desc"; break;
            case "animation_top_rated":
                url += "&sort_by=vote_average.desc&vote_count.gte=1000"; break;
            case "animation_pixar":
                url += "&with_companies=3&sort_by=popularity.desc"; break;
            case "animation_dreamworks":
                url += "&with_companies=521&sort_by=popularity.desc"; break;
            case "animation_illumination":
                url += "&with_companies=6704&sort_by=popularity.desc"; break;
            case "animation_disney":
                url += "&with_companies=2&sort_by=popularity.desc"; break;
            case "animation_action":
                genres.push("28");
                url += "&sort_by=popularity.desc"; break;
            case "animation_golden_age":
                url += "&primary_release_date.gte=1990-01-01&primary_release_date.lte=2009-12-31&sort_by=popularity.desc"; break;
            default:
                return { metas: [] };
        }

        url += `&with_genres=${genres.join(",")}`;

        try {
            const res  = await fetch(url);
            const data = await res.json();
            const metas = (data.results || []).map(movie => ({
                id         : `tmdb:${movie.id}`,
                type       : "movie",
                name       : movie.title,
                poster     : movie.poster_path   ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`      : "",
                background : movie.backdrop_path  ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : "",
                description: movie.overview,
                releaseInfo: movie.release_date ? movie.release_date.split("-")[0] : "",
            }));
            return { metas };
        } catch (err) {
            console.error("[animation catalog]", err);
            return { metas: [] };
        }
    }

    // ── Sports catalogs ───────────────────────────────────────────────────────
    if (type === "channel") {
        const path = SPORT_CATALOG_MAP[id];
        if (!path) return { metas: [] };

        try {
            const res     = await fetch(`${STREAMED_BASE}${path}`);
            if (!res.ok) return { metas: [] };
            const matches = await res.json();
            return { metas: matches.map(matchToMeta) };
        } catch (err) {
            console.error(`[sports catalog ${id}]`, err);
            return { metas: [] };
        }
    }

    return { metas: [] };
});

// ── Meta Handler ──────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ type, id }) => {

    // ── Movie meta ────────────────────────────────────────────────────────────
    if (type === "movie" && id.startsWith("tmdb:")) {
        const tmdbId = id.split(":")[1];
        try {
            const res   = await fetch(`${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_API_KEY}`);
            const movie = await res.json();
            return {
                meta: {
                    id         : `tmdb:${movie.id}`,
                    type       : "movie",
                    name       : movie.title,
                    poster     : movie.poster_path   ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`      : "",
                    background : movie.backdrop_path  ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : "",
                    description: movie.overview,
                    releaseInfo: movie.release_date ? movie.release_date.split("-")[0] : "",
                    runtime    : movie.runtime ? `${movie.runtime} min` : "",
                    imdbRating : movie.vote_average ? movie.vote_average.toFixed(1) : "",
                },
            };
        } catch (err) {
            console.error("[movie meta]", err);
            return { meta: {} };
        }
    }

    // ── Sports match meta ─────────────────────────────────────────────────────
    if (type === "channel" && id.startsWith("streamed:")) {
        const matchId = id.replace("streamed:", "");
        try {
            const match = await findMatchById(matchId);
            if (!match) return { meta: {} };
            return { meta: matchToMeta(match) };
        } catch (err) {
            console.error("[sports meta]", err);
            return { meta: {} };
        }
    }

    return { meta: {} };
});

// ── Stream Handler ────────────────────────────────────────────────────────────
builder.defineStreamHandler(async ({ type, id }) => {

    // Movies — we don't serve movie streams (resolved externally)
    if (type === "movie") return { streams: [] };

    // Sports channels
    if (type === "channel" && id.startsWith("streamed:")) {
        const matchId = id.replace("streamed:", "");
        console.log(`[stream] Resolving streams for match: ${matchId}`);

        try {
            const match = await findMatchById(matchId);
            if (!match) {
                console.warn(`[stream] Match not found: ${matchId}`);
                return { streams: [] };
            }

            console.log(`[stream] Found match "${match.title}" with ${match.sources?.length || 0} source(s)`);
            const streams = await getStreamsForMatch(match);
            console.log(`[stream] Returning ${streams.length} stream(s)`);
            return { streams };
        } catch (err) {
            console.error("[stream handler]", err);
            return { streams: [] };
        }
    }

    return { streams: [] };
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`\n🚀 Animation & Live Sports Addon running on http://localhost:${port}`);
console.log(`📺 Install in Stremio: http://localhost:${port}/manifest.json\n`);
