import pkg from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = pkg;

const TMDB_API_KEY = process.env.TMDB_API_KEY || ""; 
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

const manifest = {
    id: "community.nuvio.westernanimation",
    version: "1.1.0",
    name: "Animation Movie Hub",
    description: "Dedicated catalogs for Hollywood & Western animation movies like Minions, Pixar, and Disney (No Anime). Feature-rich categories.",
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
            id: "animation_popular",
            name: "Most Popular",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type: "movie",
            id: "animation_top_rated",
            name: "Highest Rated",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type: "movie",
            id: "animation_action",
            name: "Action",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type: "movie",
            id: "animation_comedy",
            name: "Comedy",
            extra: [{ name: "skip", isRequired: false }]
        },
        {
            type: "movie",
            id: "animation_adventure",
            name: "Adventure",
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
        // Trending: recently released and popular
        const dateOffset = new Date();
        dateOffset.setMonth(dateOffset.getMonth() - 2); // Movies from the last 2 months
        const dateStr = dateOffset.toISOString().split('T')[0];
        url += `&sort_by=popularity.desc&primary_release_date.gte=${dateStr}`;
    } else if (id === "animation_popular") {
        url += "&sort_by=popularity.desc";
    } else if (id === "animation_top_rated") {
        url += "&sort_by=vote_average.desc&vote_count.gte=500";
    } else if (id === "animation_action") {
        genres.push("28"); // Action
        url += "&sort_by=popularity.desc";
    } else if (id === "animation_comedy") {
        genres.push("35"); // Comedy
        url += "&sort_by=popularity.desc";
    } else if (id === "animation_adventure") {
        genres.push("12"); // Adventure
        url += "&sort_by=popularity.desc";
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

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`Addon running on port ${port}`);
