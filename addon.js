import express from "express";
import pkg from "stremio-addon-sdk";
const { addonBuilder, getRouter } = pkg;

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

const manifest = {
    id: "community.nuvio.westernanimation",
    version: "1.2.0",
    name: "Animation Movies",
    description: "Dedicated catalogs for Hollywood & Western animation movies. Explore Pixar, DreamWorks, Disney, Illumination, and more (No Anime).",
    resources: ["catalog", "meta"],
    types: ["movie"],
    catalogs: [
        {
            type: "movie",
            id: "animation_trending",
            name: "Trending",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type: "movie",
            id: "animation_top_rated",
            name: "Top Rated",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type: "movie",
            id: "animation_pixar",
            name: "Pixar Collection",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type: "movie",
            id: "animation_dreamworks",
            name: "DreamWorks Classics",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type: "movie",
            id: "animation_illumination",
            name: "Illumination Hits",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type: "movie",
            id: "animation_disney",
            name: "Walt Disney",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type: "movie",
            id: "animation_action",
            name: "Action & Adventure",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type: "movie",
            id: "animation_golden_age",
            name: "90s & 2000s",
            extra: [{ name: "skip", isRequired: false }]
        }
    ]
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== "movie") return { metas: [] };

    // Stremio passes extra.skip to load more items. TMDB uses pages (1 page = 20 items).
    const page = extra && extra.skip ? Math.floor(extra.skip / 20) + 1 : 1;
    let url = `${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_original_language=en&page=${page}`;

    let genres = ["16"]; // 16 is Animation

    if (id === "animation_trending") {
        url += "&sort_by=popularity.desc";
    } else if (id === "animation_top_rated") {
        url += "&sort_by=vote_average.desc&vote_count.gte=1000";
    } else if (id === "animation_pixar") {
        url += "&with_companies=3&sort_by=popularity.desc";
    } else if (id === "animation_dreamworks") {
        url += "&with_companies=521&sort_by=popularity.desc";
    } else if (id === "animation_illumination") {
        url += "&with_companies=6704&sort_by=popularity.desc";
    } else if (id === "animation_disney") {
        url += "&with_companies=2&sort_by=popularity.desc";
    } else if (id === "animation_action") {
        genres.push("28"); // Action
        url += "&sort_by=popularity.desc";
    } else if (id === "animation_golden_age") {
        url += "&primary_release_date.gte=1990-01-01&primary_release_date.lte=2009-12-31&sort_by=popularity.desc";
    }

    url += `&with_genres=${genres.join(",")}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        const movies = data.results || [];

        // Map TMDB structure to Stremio/Nuvio's Expected Meta Format
        const metas = movies.map(movie => ({
            id: `tmdb:${movie.id}`,
            type: "movie",
            name: movie.title,
            poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : "",
            background: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : "",
            description: movie.overview,
            releaseInfo: movie.release_date ? movie.release_date.split("-")[0] : ""
        }));

        return { metas };
    } catch (error) {
        console.error("Error fetching catalogs:", error);
        return { metas: [] };
    }
});

builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== "movie" || !id.startsWith("tmdb:")) return { meta: {} };

    const tmdbId = id.split(":")[1];
    const url = `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;

    try {
        const response = await fetch(url);
        const movie = await response.json();

        const meta = {
            id: `tmdb:${movie.id}`,
            type: "movie",
            name: movie.title,
            poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : "",
            background: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : "",
            description: movie.overview,
            releaseInfo: movie.release_date ? movie.release_date.split("-")[0] : "",
            runtime: movie.runtime ? `${movie.runtime} min` : "",
            imdbRating: movie.vote_average ? movie.vote_average.toFixed(1) : ""
        };

        return { meta };
    } catch (error) {
        console.error("Error fetching meta details:", error);
        return { meta: {} };
    }
});

// --- CUSTOM EXPRESS SERVER IMPLEMENTATION ---
const port = process.env.PORT || 7860;
const app = express();

// Route Stremio requests through Express
app.use(getRouter(builder.getInterface()));

// Explicitly bind to 0.0.0.0 so Hugging Face can detect the running application
app.listen(port, '0.0.0.0', () => {
    console.log(`Addon successfully running on http://0.0.0.0:${port}`);
});