import pkg from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = pkg;

// ─── Config ───────────────────────────────────────────────────────────────────
const TMDB_API_KEY = process.env.TMDB_API_KEY || ""; 
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const PROXY_URL = process.env.PROXY_URL || "https://afsalknassar-cinepro-org.hf.space";

// ─── Manifest ─────────────────────────────────────────────────────────────────
const manifest = {
    id: "community.nuvio.westernanimation",
    version: "3.0.0",
    name: "Animation & Live Sports",
    description: "Hollywood & Western animation movies + Live sports streaming via RebelIPTV proxy.",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "tv"],
    catalogs: [
        // ── Animation ────────────────────────────────────────────────────────
        { type: "movie", id: "animation_trending",     name: "🎬 Trending Animation", extra: [{ name: "skip", isRequired: false }] },
        { type: "movie", id: "animation_top_rated",    name: "⭐ Top Rated Animation", extra: [{ name: "skip", isRequired: false }] },
        { type: "movie", id: "animation_pixar",        name: "✨ Pixar Collection", extra: [{ name: "skip", isRequired: false }] },
        { type: "movie", id: "animation_dreamworks",   name: "🐉 DreamWorks Classics", extra: [{ name: "skip", isRequired: false }] },
        { type: "movie", id: "animation_illumination", name: "🎪 Illumination Hits", extra: [{ name: "skip", isRequired: false }] },
        { type: "movie", id: "animation_disney",       name: "🏰 Walt Disney", extra: [{ name: "skip", isRequired: false }] },
        { type: "movie", id: "animation_action",       name: "💥 Action & Adventure", extra: [{ name: "skip", isRequired: false }] },
        
        // ── Live Sports & TV ──────────────────────────────────────────────────
        { type: "tv", id: "iptv_events",   name: "🏆 Live Sports Events" },
        { type: "tv", id: "iptv_channels", name: "📺 Live TV Channels" }
    ],
    behaviorHints: {
        configurable: false,
        newEpisodeNotifications: false,
    },
};

// ─── Proxy Helpers ────────────────────────────────────────────────────────────

async function getProxyData(path) {
    try {
        const res = await fetch(`${PROXY_URL}${path}`);
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.error(`[Proxy API Error] ${path}:`, err.message);
        return null;
    }
}

// Convert proxy event to Stremio Meta
function eventToMeta(event) {
    const timeStr = event.startTime 
        ? new Date(event.startTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) 
        : "";
    
    return {
        id: `iptv_event:${event.channelId}`,
        type: "tv",
        name: event.name,
        poster: null,
        background: null,
        description: `Category: ${event.category}\nStatus: ${event.statusDetail?.detail || "Unknown"}\nStart: ${timeStr}`,
        genres: [event.category],
    };
}

// Convert proxy channel to Stremio Meta
function channelToMeta(channel) {
    return {
        id: `iptv_channel:${channel.slug}`,
        type: "tv",
        name: channel.name,
        poster: channel.hasSvg ? `https://img.rebeliptv.net/channel/${channel.slug}.png` : null,
        description: `Categories: ${(channel.categories || []).join(", ")}`,
        genres: channel.categories,
    };
}

// ─── Builder ──────────────────────────────────────────────────────────────────
const builder = new addonBuilder(manifest);

// ── Catalog Handler ───────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id, extra }) => {

    // ── Movie catalogs (animation) ────────────────────────────────────────────
    if (type === "movie") {
        const page = extra?.skip ? Math.floor(extra.skip / 20) + 1 : 1;
        let url = `${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_original_language=en&page=${page}`;
        let genres = ["16"]; // Animation genre

        switch (id) {
            case "animation_trending":     url += "&sort_by=popularity.desc"; break;
            case "animation_top_rated":    url += "&sort_by=vote_average.desc&vote_count.gte=1000"; break;
            case "animation_pixar":        url += "&with_companies=3&sort_by=popularity.desc"; break;
            case "animation_dreamworks":   url += "&with_companies=521&sort_by=popularity.desc"; break;
            case "animation_illumination": url += "&with_companies=6704&sort_by=popularity.desc"; break;
            case "animation_disney":       url += "&with_companies=2&sort_by=popularity.desc"; break;
            case "animation_action":       genres.push("28"); url += "&sort_by=popularity.desc"; break;
            default: return { metas: [] };
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

    // ── Proxy Catalogs (Sports & TV) ──────────────────────────────────────────
    if (type === "tv") {
        if (id === "iptv_events") {
            const data = await getProxyData("/api/events");
            if (data?.value) {
                return { metas: data.value.map(eventToMeta) };
            }
        }
        if (id === "iptv_channels") {
            const data = await getProxyData("/api/channels");
            if (data?.value) {
                // Filter out hidden channels and map to meta
                const activeChannels = data.value.filter(c => !c.hidden && c.online !== false);
                return { metas: activeChannels.map(channelToMeta) };
            }
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
            const res   = await fetch(`${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${TMDB_API_KEY}`);
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

    // ── Proxy Meta ────────────────────────────────────────────────────────────
    if (type === "tv" && id.startsWith("iptv_event:")) {
        const channelId = id.replace("iptv_event:", "");
        const data = await getProxyData("/api/events");
        if (data?.value) {
            const event = data.value.find(e => e.channelId === channelId);
            if (event) return { meta: eventToMeta(event) };
        }
    }

    if (type === "tv" && id.startsWith("iptv_channel:")) {
        const slug = id.replace("iptv_channel:", "");
        const data = await getProxyData("/api/channels");
        if (data?.value) {
            const channel = data.value.find(c => c.slug === slug);
            if (channel) return { meta: channelToMeta(channel) };
        }
    }

    return { meta: {} };
});

// ── Stream Handler ────────────────────────────────────────────────────────────
builder.defineStreamHandler(async ({ type, id }) => {

    if (type === "movie") return { streams: [] };

    // Streams for Events
    if (type === "tv" && id.startsWith("iptv_event:")) {
        const channelId = id.replace("iptv_event:", "");
        return {
            streams: [{
                name: "🔴 RebelIPTV",
                title: "Play Stream",
                url: `${PROXY_URL}/stream/${channelId}.ts`,
                behaviorHints: { notWebReady: false },
            }]
        };
    }

    // Streams for Channels
    if (type === "tv" && id.startsWith("iptv_channel:")) {
        const slug = id.replace("iptv_channel:", "");
        return {
            streams: [{
                name: "📺 RebelIPTV",
                title: "Play Live Channel",
                url: `${PROXY_URL}/stream/${slug}.ts`,
                behaviorHints: { notWebReady: false },
            }]
        };
    }

    return { streams: [] };
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`\n🚀 Animation & IPTV Addon running on http://localhost:${port}`);
console.log(`📺 Install in Stremio: http://localhost:${port}/manifest.json\n`);
