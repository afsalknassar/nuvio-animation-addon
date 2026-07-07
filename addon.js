import pkg from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = pkg;

const TMDB_API_KEY = process.env.TMDB_API_KEY || ""; 
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

const manifest = {
    id: "community.nuvio.westernanimation",
    version: "1.0.0",
    name: "Animation Movie Hub",
    description: "Dedicated catalogs for Hollywood & Western animation movies like Minions, Pixar, and Disney (No Anime).",
    resources: ["catalog", "meta"],
    types: ["movie"],
    catalogs: [
        {
            type: "movie",
            id: "trending_animation",
            name: "Trending Animation"
        },
        {
            type: "movie",
            id: "top_animation",
            name: "Top Animated Movies"
        }
    ]
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id }) => {
    if (type !== "movie") return { metas: [] };

    let url = `${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=16&with_original_language=en`;

    if (id === "trending_animation") {
        url += "&sort_by=popularity.desc";
    } else if (id === "top_animation") {
        url += "&sort_by=vote_average.desc&vote_count.gte=500";
    }

    try {
        const response = await fetch(url);
        const data = await response.json();
        const movies = data.results || [];

        // Map TMDB structure to Stremio/Nuvio's Expected Meta Format
        const metas = movies.map(movie => ({
            id: `tmdb:${movie.id}`, 
            type: "movie",
            name: movie.title,
            poster: `https://image.tmdb.org/t/p/w500${movie.poster_path}`,
            background: `https://image.tmdb.org/t/p/original${movie.backdrop_path}`,
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
            poster: `https://image.tmdb.org/t/p/w500${movie.poster_path}`,
            background: `https://image.tmdb.org/t/p/original${movie.backdrop_path}`,
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
