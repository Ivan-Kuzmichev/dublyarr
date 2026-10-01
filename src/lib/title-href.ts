// Ссылка на карточку: сериал/аниме — /series, фильм — /movie (id сериалов и фильмов в TMDB пересекаются).
export const titleHref = (t: { kind: string; tmdbId: number }) => `/${t.kind === 'movie' ? 'movie' : 'series'}/${t.tmdbId}`;
