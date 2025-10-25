import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { movieApi, MovieSource } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MovieNotAvailable } from '@/components/MovieNotAvailable';
import { EpisodeSelector } from '@/components/EpisodeSelector';
import { QualitySelector } from '@/components/QualitySelector';
import { Play, Download, Star, Clock, Calendar, ArrowLeft, Loader2, Share2 } from 'lucide-react';
import { DownloadOptionsDialog } from '@/components/DownloadOptionsDialog';
import { toast } from 'sonner';
import { downloadVideoWithSubtitles } from '@/lib/downloadWithSubtitles';

export default function MovieDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loadingSourceId, setLoadingSourceId] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<'stream' | 'download' | null>(null);
  const [isTrailerPlaying, setIsTrailerPlaying] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const trailerRef = useRef<HTMLVideoElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isQualitySelectorOpen, setIsQualitySelectorOpen] = useState(false);
  const [qualitySelectorMode, setQualitySelectorMode] = useState<'stream' | 'download'>('stream');
  const [isDownloadOptionsOpen, setIsDownloadOptionsOpen] = useState(false);
  const [pendingDownload, setPendingDownload] = useState<{ url: string; title: string; subtitles?: any[] } | null>(null);

  const { data: movie, isLoading: movieLoading, error: movieError } = useQuery({
    queryKey: ['movie', id],
    queryFn: () => movieApi.getMovieDetails(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: sources, isLoading: sourcesLoading } = useQuery({
    queryKey: ['sources', id],
    queryFn: () => movieApi.getMovieSources(id!),
    enabled: !!id && !!movie,
    staleTime: 5 * 60 * 1000,
  });

  // Auto-scroll to trailer when page loads
  useEffect(() => {
    if (movie && trailerRef.current) {
      setTimeout(() => {
        trailerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 500);
    }
  }, [movie]);

  const handleWatch = useCallback((url: string, title: string, allSources?: any[], sourceId?: string) => {
    if (!url) {
      toast.error('Stream URL not available');
      return;
    }
    if (sourceId) {
      setLoadingSourceId(sourceId);
      setLoadingAction('stream');
    }

    // Save to watch history with poster and seasons data
    const watchHistory = JSON.parse(localStorage.getItem('watch_history') || '[]');
    const newEntry = {
      id: movie?.id,
      title: movie?.title,
      poster: movie?.poster,
      watchedAt: new Date().toISOString(),
      seasons: movie?.seasons ? encodeURIComponent(JSON.stringify(movie.seasons)) : undefined,
      isSeries: movie?.isSeries || false
    };
    const updatedHistory = [newEntry, ...watchHistory.filter((item: any) => item.id !== movie?.id)].slice(0, 50);
    localStorage.setItem('watch_history', JSON.stringify(updatedHistory));

    // Get subtitles from sources (first source with subtitles) or from movie details
    const subtitles = (allSources && allSources.length > 0 && allSources[0].subtitles) 
      ? allSources[0].subtitles 
      : movie?.subtitles;

    // Navigate to player page with subtitles
    setTimeout(() => {
      const searchParams = new URLSearchParams();
      searchParams.set('url', url);
      searchParams.set('title', title);
      searchParams.set('movieId', id || '');
      searchParams.set('movieTitle', movie?.title || '');
      searchParams.set('poster', movie?.poster || '');
      if (movie?.seasons) {
        searchParams.set('seasons', encodeURIComponent(JSON.stringify(movie.seasons)));
      }
      if (allSources) {
        searchParams.set('sources', encodeURIComponent(JSON.stringify(allSources)));
      }
      if (subtitles) {
        searchParams.set('subtitles', encodeURIComponent(JSON.stringify(subtitles)));
      }
      navigate(`/player?${searchParams.toString()}`);
      setLoadingSourceId(null);
      setLoadingAction(null);
    }, 800);
  }, [movie, id, navigate]);

  const handleDownload = useCallback((url: string, title: string, sourceId?: string, sourceSubtitles?: any[]) => {
    if (!url) {
      toast.error('Download URL not available');
      return;
    }
    
    // Use subtitles from source or fall back to movie subtitles
    const subtitles = sourceSubtitles || movie?.subtitles || undefined;
    
    // Store pending download and show options dialog
    setPendingDownload({ url, title, subtitles });
    setIsDownloadOptionsOpen(true);
    
    if (sourceId) {
      setLoadingSourceId(sourceId);
      setLoadingAction('download');
    }
  }, [movie?.subtitles]);

  const handleDownloadWithSubtitles = useCallback(() => {
    if (!pendingDownload) return;
    
    downloadVideoWithSubtitles(
      pendingDownload.url,
      pendingDownload.title,
      pendingDownload.subtitles
    ).finally(() => {
      setLoadingSourceId(null);
      setLoadingAction(null);
    });
    
    toast.success(`Downloading ${pendingDownload.title} with subtitles`);
    setPendingDownload(null);
  }, [pendingDownload]);

  const handleDownloadVideoOnly = useCallback(() => {
    if (!pendingDownload) return;
    
    // Direct download without subtitles
    const link = document.createElement('a');
    link.href = pendingDownload.url;
    link.download = `${pendingDownload.title}.mp4`;
    link.click();
    
    toast.success(`Downloading ${pendingDownload.title}`);
    
    setLoadingSourceId(null);
    setLoadingAction(null);
    setPendingDownload(null);
  }, [pendingDownload]);

  // Enhanced episode handlers that fetch sources dynamically
  const handleEpisodeWatch = useCallback(async (movieId: string, season: number, episode: number, quality?: string) => {
    try {
      setLoadingSourceId(`ep-${season}-${episode}`);
      setLoadingAction('stream');
      const sources = await movieApi.getEpisodeSources(movieId, season, episode);
      if (sources.length === 0) {
        toast.error('No sources available for this episode');
        setLoadingSourceId(null);
        setLoadingAction(null);
        return;
      }
      
      // Find the requested quality or use the first available
      const source = quality 
        ? sources.find(s => s.quality === quality) || sources[0]
        : sources[0];
      
      // Navigate to player page with poster and subtitles from episode sources
      setTimeout(() => {
        const searchParams = new URLSearchParams();
        searchParams.set('url', source.stream_url || source.download_url);
        searchParams.set('title', `${movie?.title} S${season}E${episode} - ${source.quality}`);
        searchParams.set('movieId', movieId);
        searchParams.set('movieTitle', movie?.title || '');
        searchParams.set('poster', movie?.poster || '');
        searchParams.set('season', season.toString());
        searchParams.set('episode', episode.toString());
        if (movie?.seasons) {
          searchParams.set('seasons', encodeURIComponent(JSON.stringify(movie.seasons)));
          searchParams.set('sources', encodeURIComponent(JSON.stringify(sources)));
        }
        // Use subtitles from episode sources (preferred) or movie details
        const episodeSubtitles = source.subtitles || movie?.subtitles;
        if (episodeSubtitles) {
          searchParams.set('subtitles', encodeURIComponent(JSON.stringify(episodeSubtitles)));
        }
        navigate(`/player?${searchParams.toString()}`);
        setLoadingSourceId(null);
        setLoadingAction(null);
      }, 800);
    } catch (error) {
      console.error('Error fetching episode sources:', error);
      toast.error('Failed to load episode sources');
      setLoadingSourceId(null);
      setLoadingAction(null);
    }
  }, [movie?.title, movie?.seasons, movie?.subtitles, navigate]);

  const handleEpisodeDownload = useCallback(async (movieId: string, season: number, episode: number, quality?: string) => {
    try {
      const sources = await movieApi.getEpisodeSources(movieId, season, episode);
      if (sources.length === 0) {
        toast.error('No sources available for this episode');
        return;
      }
      
      // Find the requested quality or use the first available
      const source = quality 
        ? sources.find(s => s.quality === quality) || sources[0]
        : sources[0];
      
      handleDownload(source.download_url, `${movie?.title} S${season}E${episode} - ${source.quality}`, `ep-${season}-${episode}`, source.subtitles);
    } catch (error) {
      console.error('Error fetching episode sources:', error);
      toast.error('Failed to load episode sources');
      setLoadingSourceId(null);
      setLoadingAction(null);
    }
  }, [movie?.title, handleDownload]);

  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard!');
    } catch (err) {
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        toast.success('Link copied to clipboard!');
      } catch (e) {
        toast.error('Could not copy link');
      }
      document.body.removeChild(textArea);
    }
  };

  if (movieError) {
    return <MovieNotAvailable />;
  }

  if (movieLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="grid md:grid-cols-[300px,1fr] gap-8">
          <Skeleton className="aspect-[2/3] rounded-lg" />
          <div className="space-y-4">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-10 w-48" />
          </div>
        </div>
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <p className="text-muted-foreground">Movie not found</p>
      </div>
    );
  }

  const posterUrl = movie.poster || '/placeholder.svg';

  return (
    <>
      <div className="container mx-auto px-4 py-8 pt-24 max-w-7xl overflow-x-hidden">
        {/* Back and Share Buttons */}
        <div className="flex items-center justify-between mb-4 gap-2">
          <Button
            variant="ghost"
            onClick={() => navigate('/')}
            className="gap-2 flex-shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to Home</span>
            <span className="sm:hidden">Back</span>
          </Button>
          <Button
            variant="outline"
            onClick={handleShare}
            className="gap-2 flex-shrink-0"
          >
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">Share</span>
          </Button>
        </div>

        <div className="grid md:grid-cols-[250px,1fr] gap-6 overflow-x-hidden">
          {/* Poster */}
          <div className="space-y-4 flex-shrink-0">
            <img
              src={posterUrl}
              alt={movie.title}
              className="w-full max-w-[250px] mx-auto rounded-lg shadow-lg"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = '/placeholder.svg';
              }}
            />
          </div>

          {/* Details */}
          <div className="space-y-6 min-w-0 overflow-x-hidden">{/* min-w-0 prevents flex item overflow */}
            <div className="overflow-x-hidden">
              <h1 className="text-2xl sm:text-4xl font-bold mb-2 text-shadow-red break-words">{movie.title}</h1>
              
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                {movie.year && (
                  <div className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    <span>{movie.year}</span>
                  </div>
                )}
                {movie.duration && (
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    <span>{movie.duration}</span>
                  </div>
                )}
                {movie.rating && (
                  <div className="flex items-center gap-1">
                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    <span>{movie.rating}</span>
                  </div>
                )}
              </div>

              {movie.genre && movie.genre.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {movie.genre.map((g) => (
                    <span key={g} className="px-3 py-1 bg-secondary rounded-full text-xs">
                      {g}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Trailer */}
            {(movie.trailer || movie.trailer_url) && (() => {
              // Extract trailer URL from potentially nested structure
              let trailerUrl = movie.trailer_url;
              if (typeof movie.trailer === 'string') {
                trailerUrl = movie.trailer;
              } else if (movie.trailer && typeof movie.trailer === 'object' && movie.trailer.videoAddress?.url) {
                trailerUrl = movie.trailer.videoAddress.url;
              }
              
              return trailerUrl ? (
                <div>
                  <h2 className="text-xl font-semibold mb-3">Trailer</h2>
                  <div className="relative aspect-video rounded-lg overflow-hidden bg-black animate-fade-in">
                    <video
                      ref={trailerRef}
                      data-trailer
                      src={trailerUrl}
                      className="w-full h-full"
                      playsInline
                      controls
                      preload="auto"
                      onPlay={() => setIsTrailerPlaying(true)}
                      onPause={() => setIsTrailerPlaying(false)}
                      onEnded={() => setIsTrailerPlaying(false)}
                    >
                      Your browser does not support the video tag.
                    </video>
                  </div>
                  <div className="flex justify-center mt-4">
                    <Button
                      size="lg"
                      onClick={() => {
                        if (trailerRef.current) {
                          if (isTrailerPlaying) {
                            trailerRef.current.pause();
                          } else {
                            const playPromise = trailerRef.current.play();
                            if (playPromise !== undefined) {
                              playPromise.catch((error) => {
                                console.log('Play prevented:', error);
                              });
                            }
                          }
                        }
                      }}
                      className="gap-2 cinema-gradient hover:scale-105 active:scale-95 transition-all duration-200"
                    >
                      <Play className="h-5 w-5 transition-transform group-hover:scale-110" />
                      {isTrailerPlaying ? 'Pause Trailer' : 'Play Trailer'}
                    </Button>
                  </div>
                </div>
              ) : null;
            })()}

            {/* Description */}
            {(movie.overview || movie.description) && (
              <div>
                <h2 className="text-xl font-semibold mb-2">Overview</h2>
                <p className="text-muted-foreground leading-relaxed">
                  {movie.overview || movie.description}
                </p>
              </div>
            )}

            {/* Cast & Director */}
            {(movie.cast || movie.director) && (
              <div className="space-y-3">
                {movie.director && (
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-1">Director</h3>
                    <p>{movie.director}</p>
                  </div>
                )}
                {movie.cast && movie.cast.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-1">Cast</h3>
                    <p className="text-sm">{movie.cast.slice(0, 5).join(', ')}</p>
                  </div>
                )}
              </div>
            )}

            {/* Sources or Episodes */}
            {movie.isSeries && movie.seasons && movie.seasons.length > 0 ? (
              <EpisodeSelector
                seasons={movie.seasons}
                onWatch={(url, title) => handleWatch(url, title)}
                onDownload={(url, title) => handleDownload(url, title)}
                movieTitle={movie.title}
                movieId={movie.id}
                onEpisodeWatch={handleEpisodeWatch}
                onEpisodeDownload={handleEpisodeDownload}
                loadingSourceId={loadingSourceId}
                loadingAction={loadingAction}
              />
            ) : (
              <div>
                <h2 className="text-xl font-semibold mb-4">Watch & Download</h2>
                
                {sourcesLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : sources && sources.length > 0 ? (
                  <div className="space-y-3">
                    {/* Single Stream/Download Buttons that open quality selector */}
                    <div className="flex gap-3">
                      <Button
                        onClick={() => {
                          setQualitySelectorMode('stream');
                          setIsQualitySelectorOpen(true);
                        }}
                        className="gap-2 flex-1 h-16 text-lg transition-all duration-300 hover:shadow-lg hover:shadow-primary/50 group"
                      >
                        <Play className="h-6 w-6 transition-transform group-hover:scale-110" />
                        Stream
                      </Button>
                      <Button
                        onClick={() => {
                          setQualitySelectorMode('download');
                          setIsQualitySelectorOpen(true);
                        }}
                        variant="secondary"
                        className="gap-2 flex-1 h-16 text-lg transition-all duration-300 hover:shadow-lg hover:shadow-secondary/50 group"
                      >
                        <Download className="h-6 w-6 transition-transform group-hover:scale-110" />
                        Download
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 border border-muted rounded-lg">
                    <p className="text-muted-foreground text-sm">
                      Download sources are being prepared. Please check back later or try the search feature to find alternative versions.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quality Selector Modal */}
      {sources && sources.length > 0 && (
        <>
          <QualitySelector
            sources={sources}
            isOpen={isQualitySelectorOpen}
            onClose={() => setIsQualitySelectorOpen(false)}
            onSelect={(source) => {
              if (qualitySelectorMode === 'stream') {
                handleWatch(source.stream_url || source.download_url, source.quality, sources);
              } else {
                handleDownload(source.download_url, source.quality, source.id, source.subtitles);
              }
            }}
            mode={qualitySelectorMode}
            title={movie?.title}
          />
          
          <DownloadOptionsDialog
            isOpen={isDownloadOptionsOpen}
            onClose={() => {
              setIsDownloadOptionsOpen(false);
              setPendingDownload(null);
              setLoadingSourceId(null);
              setLoadingAction(null);
            }}
            onDownloadWithSubtitles={handleDownloadWithSubtitles}
            onDownloadVideoOnly={handleDownloadVideoOnly}
            title={pendingDownload?.title}
            hasSubtitles={!!pendingDownload?.subtitles && pendingDownload.subtitles.length > 0}
          />
        </>
      )}
    </>
  );
}
