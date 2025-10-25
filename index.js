const express = require('express');
const axios = require('axios');
const fs = require('fs');
const cheerio = require('cheerio');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const app = express();
const PORT = process.env.PORT || 5435;

// Middleware
app.use(express.json());
app.set('json spaces', 2);
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// API configuration
const MIRROR_HOSTS = [
    "h5.aoneroom.com",
    "movieboxapp.in", 
    "moviebox.pk",
    "moviebox.ph",
    "moviebox.id",
    "v.moviebox.ph",
    "netnaija.video"
];

const SELECTED_HOST = process.env.MOVIEBOX_API_HOST || "h5.aoneroom.com";
const HOST_URL = `https://${SELECTED_HOST}`;

// Alternative hosts for download endpoint
const DOWNLOAD_MIRRORS = [
    "moviebox.pk",
    "moviebox.ph", 
    "moviebox.id",
    "v.moviebox.ph",
    "h5.aoneroom.com"
];

const DEFAULT_HEADERS = {
    'X-Client-Info': '{"timezone":"Africa/Nairobi"}',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept': 'application/json',
    'User-Agent': 'okhttp/4.12.0', // Mobile app user agent from PCAP
    'Referer': HOST_URL,
    'Host': SELECTED_HOST,
    'Connection': 'keep-alive',
    // Add IP spoofing headers to bypass region restrictions
    'X-Forwarded-For': '1.1.1.1',
    'CF-Connecting-IP': '1.1.1.1',
    'X-Real-IP': '1.1.1.1'
};

// Subject types
const SubjectType = {
    ALL: 0,
    MOVIES: 1,
    TV_SERIES: 2,
    MUSIC: 6
};

const jar = new CookieJar();
const axiosInstance = wrapper(axios.create({
    jar,
    withCredentials: true,
    timeout: 30000
}));

let movieboxAppInfo = null;
let cookiesInitialized = false;

// Helper functions
function processApiResponse(response) {
    if (response.data && response.data.data) {
        return response.data.data;
    }
    return response.data || response;
}

async function ensureCookiesAreAssigned() {
    if (!cookiesInitialized) {
        try {
            const response = await axiosInstance.get(`${HOST_URL}/wefeed-h5-bff/app/get-latest-app-pkgs?app_name=moviebox`, {
                headers: DEFAULT_HEADERS
            });
            
            movieboxAppInfo = processApiResponse(response);
            cookiesInitialized = true;
            
            if (response.headers['set-cookie']) {
                console.log('Received cookies:', response.headers['set-cookie']);
            }
            
        } catch (error) {
            console.error('Failed to get app info:', error.message);
            throw error;
        }
    }
    return cookiesInitialized;
}

async function makeApiRequest(url, options = {}) {
    await ensureCookiesAreAssigned();
    
    const config = {
        url: url,
        headers: { ...DEFAULT_HEADERS, ...options.headers },
        withCredentials: true,
        ...options
    };
    
    try {
        const response = await axiosInstance(config);
        return response;
    } catch (error) {
        console.error(`Request to ${url} failed:`, error.response?.status, error.response?.statusText);
        throw error;
    }
}

async function makeApiRequestWithCookies(url, options = {}) {
    await ensureCookiesAreAssigned();
    
    const config = {
        url: url,
        headers: { ...DEFAULT_HEADERS, ...options.headers },
        withCredentials: true,
        ...options
    };
    
    try {
        const response = await axiosInstance(config);
        return response;
    } catch (error) {
        console.error(`Request with cookies to ${url} failed:`, error.response?.status, error.response?.statusText);
        throw error;
    }
}


app.get('/', (req, res) => {
    const html = fs.readFileSync('./index.html', 'utf8');
    res.send(html);
});
   

app.get('/health', (req, res) => {
     res.json({
            status: 200,
            success: 'true',
            creator: 'GiftedTech',
            message: 'Gifted Movies Api is Running'
        });
});


// Homepage content
app.get('/api/homepage', async (req, res) => {
    try {
        const response = await makeApiRequest(`${HOST_URL}/wefeed-h5-bff/web/home`);
        const content = processApiResponse(response);
        
        res.json({
            status: 200,
            success: 'true',
            creator: 'GiftedTech',
            results: content
        });
    } catch (error) {
        console.error('Homepage error:', error.message);
        res.status(500).json({
            status: 500,
            success: 'false',
            creator: 'GiftedTech',
            message: 'Failed to fetch homepage content',
            error: error.message
        });
    }
});

// Trending content
app.get('/api/trending', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 0;
        const perPage = parseInt(req.query.perPage) || 18;
        
        const params = {
            page,
            perPage,
            uid: '5591179548772780352'
        };
        
        const response = await makeApiRequestWithCookies(`${HOST_URL}/wefeed-h5-bff/web/subject/trending`, {
            method: 'GET',
            params
        });
        
        const content = processApiResponse(response);
        
        res.json({
            status: 200,
            success: 'true',
            creator: 'GiftedTech',
            results: content
        });
    } catch (error) {
        console.error('Trending error:', error.message);
        res.status(500).json({
            status: 500,
            success: 'false',
            creator: 'GiftedTech',
            message: 'Failed to fetch trending content',
            error: error.message
        });
    }
});

// Search movies and TV series
app.get('/api/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 24;
        const subjectType = parseInt(req.query.type) || SubjectType.ALL;
        
        const payload = {
            keyword: query,
            page,
            perPage,
            subjectType
        };
        
        const response = await makeApiRequestWithCookies(`${HOST_URL}/wefeed-h5-bff/web/subject/search`, {
            method: 'POST',
            data: payload
        });
        
        let content = processApiResponse(response);
        
        if (subjectType !== SubjectType.ALL && content.items) {
            content.items = content.items.filter(item => item.subjectType === subjectType);
        }
        
        if (content.items) {
            content.items.forEach(item => {
                if (item.cover && item.cover.url) {
                    item.thumbnail = item.cover.url;
                }
                if (item.stills && item.stills.url && !item.thumbnail) {
                    item.thumbnail = item.stills.url;
                }
            });
        }
        
        res.json({
            status: 200,
            success: 'true',
            creator: 'GiftedTech',
            results: content
        });
    } catch (error) {
        console.error('Search error:', error.message);
        res.status(500).json({
            status: 500,
            success: 'false',
            creator: 'GiftedTech',
            message: 'Failed to search content',
            error: error.message
        });
    }
});

// Get movie/series detailed information
app.get('/api/info/:movieId', async (req, res) => {
    try {
        const { movieId } = req.params;
        
        const response = await makeApiRequestWithCookies(`${HOST_URL}/wefeed-h5-bff/web/subject/detail`, {
            method: 'GET',
            params: { subjectId: movieId }
        });
        
        const content = processApiResponse(response);
        
        if (content.subject) {
            if (content.subject.cover && content.subject.cover.url) {
                content.subject.thumbnail = content.subject.cover.url;
            }
            if (content.subject.stills && content.subject.stills.url && !content.subject.thumbnail) {
                content.subject.thumbnail = content.subject.stills.url;
            }
        }
        
        res.json({
            status: 200,
            success: 'true',
            creator: 'GiftedTech',
            results: content
        });
    } catch (error) {
        console.error('Info error:', error.message);
        res.status(500).json({
            status: 500,
            success: 'false',
            creator: 'GiftedTech',
            message: 'Failed to fetch movie/series info',
            error: error.message
        });
    }
});

// Get streaming sources/download links
// Get streaming sources/download links
app.get('/api/sources/:movieId', async (req, res) => {
    try {
        const { movieId } = req.params;
        const season = parseInt(req.query.season) || 0;
        const episode = parseInt(req.query.episode) || 0;
        
        const infoResponse = await makeApiRequestWithCookies(`${HOST_URL}/wefeed-h5-bff/web/subject/detail`, {
            method: 'GET',
            params: { subjectId: movieId }
        });
        
        const movieInfo = processApiResponse(infoResponse);
        const detailPath = movieInfo?.subject?.detailPath;
        
        if (!detailPath) {
            throw new Error('Could not get movie detail path for referer header');
        }
        
        const refererUrl = `https://fmoviesunblocked.net/spa/videoPlayPage/movies/${detailPath}?id=${movieId}&type=/movie/detail`;
        
        const params = {
            subjectId: movieId,
            se: season,
            ep: episode
        };
        
        const response = await makeApiRequestWithCookies(`${HOST_URL}/wefeed-h5-bff/web/subject/download`, {
            method: 'GET',
            params,
            headers: {
                'Referer': refererUrl,
                'Origin': 'https://fmoviesunblocked.net',
                'X-Forwarded-For': '1.1.1.1',
                'CF-Connecting-IP': '1.1.1.1',
                'X-Real-IP': '1.1.1.1'
            }
        });
        
        const content = processApiResponse(response);
        let sources = [];
        let captions = [];
        
        if (content && content.downloads) {
            sources = content.downloads.map(file => ({
                id: file.id,
                quality: `${file.resolution}p` || 'Unknown',
                download_url: `https://${req.get('host')}/api/download/${encodeURIComponent(file.url)}`, 
                stream_url: `https://${req.get('host')}/api/stream/${encodeURIComponent(file.url)}`,
                size: file.size,
                format: 'mp4'
            }));
        }
        
        // Safely get captions if they exist
        if (content && content.captions) {
            captions = content.captions;
        }
        
        res.json({
            status: 200,
            success: 'true',
            creator: 'GiftedTech',
            results: sources,
            subtitles: captions
        });
    } catch (error) {
        console.error('Sources error:', error.message);
        res.status(500).json({
            status: 500,
            success: 'false',
            creator: 'GiftedTech',
            message: 'Failed to fetch streaming sources',
            error: error.message
        });
    }
});

// Download proxy endpoint 
app.get('/api/download/*', async (req, res) => {
    try {
        const downloadUrl = decodeURIComponent(req.url.replace('/api/download/', '')); 
        if (!downloadUrl || (!downloadUrl.startsWith('https://bcdnw.hakunaymatata.com/') && !downloadUrl.startsWith('https://valiw.hakunaymatata.com/'))) {
            return res.status(400).json({
                status: 400,
                success: 'false',
                creator: 'GiftedTech',
                message: 'Invalid download URL'
            });
        }
        
        const response = await axios({
            method: 'GET',
            url: downloadUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'okhttp/4.12.0',
                'Referer': 'https://fmoviesunblocked.net/',
                'Origin': 'https://fmoviesunblocked.net'
            }
        });
        
const contentDisposition = response.headers['content-disposition'];
let filename = 'Movie_by_GiftedTech.mp4'; 

if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename="([^"]+)"/) || 
                         contentDisposition.match(/filename=([^;]+)/);
    if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1].trim();
        filename = filename.split(/[\\/]/).pop();
    }
}

res.set({
    'Content-Type': response.headers['content-type'],
    'Content-Length': response.headers['content-length'],
    'Content-Disposition': `attachment; filename="${filename}"`
});

response.data.pipe(res);

    } catch (error) {
        console.error('Download proxy error:', error.message);
        res.status(500).json({
            status: 500,
            success: 'false',
            creator: 'GiftedTech',
            message: 'Failed to proxy download',
            error: error.message
        });
    }
});


// Stream proxy endpoint - OPTIMIZED FOR SPEED
app.get('/api/stream/*', async (req, res) => {
    try {
        const streamUrl = decodeURIComponent(req.url.replace('/api/stream/', ''));
        
        if (!streamUrl || (!streamUrl.startsWith('https://bcdnw.hakunaymatata.com/') && !streamUrl.startsWith('https://valiw.hakunaymatata.com/'))) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid stream URL'
            });
        }
        
        console.log(`Proxying stream with range support: ${streamUrl}`);
        
        // Headers to forward to the CDN
        const headers = {
            'User-Agent': 'okhttp/4.12.0',
            'Referer': 'https://fmoviesunblocked.net/',
            'Origin': 'https://fmoviesunblocked.net',
            'Accept': '*/*',
            'Accept-Encoding': 'identity' // Important: disable gzip for video streaming
        };
        
        // Forward the Range header if present
        if (req.headers.range) {
            headers['Range'] = req.headers.range;
            console.log(`Forwarding range request: ${req.headers.range}`);
        }
        
        // Make the request to CDN
        const response = await axios({
            method: 'GET',
            url: streamUrl,
            responseType: 'stream',
            headers: headers,
            timeout: 30000
        });
        
        // Handle successful response
        if (response.status === 200 || response.status === 206) {
            // Set appropriate headers for streaming (inline playback)
            res.set({
                'Content-Type': response.headers['content-type'],
                'Content-Disposition': 'inline; filename="stream.mp4"',
                'Cache-Control': 'public, max-age=3600',
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Range'
            });
            
            // Handle partial content (206)
            if (response.status === 206 && response.headers['content-range']) {
                res.status(206);
                res.set('Content-Range', response.headers['content-range']);
                res.set('Content-Length', response.headers['content-length']);
                console.log(`Serving partial content: ${response.headers['content-range']}`);
            } 
            // Handle full content (200)
            else if (response.status === 200 && response.headers['content-length']) {
                res.status(200);
                res.set('Content-Length', response.headers['content-length']);
                console.log(`Serving full content, length: ${response.headers['content-length']}`);
            }
            
            // Pipe the video stream to response
            response.data.pipe(res);
            
            // Handle stream errors
            response.data.on('error', (error) => {
                console.error('Stream error:', error.message);
                if (!res.headersSent) {
                    res.status(500).json({
                        status: 'error',
                        message: 'Stream error occurred'
                    });
                }
            });
            
        } else {
            throw new Error(`Unexpected response status: ${response.status}`);
        }
        
    } catch (error) {
        console.error('Stream proxy error:', error.message);
        
        if (!res.headersSent) {
            res.status(500).json({
                status: 'error',
                message: 'Failed to proxy stream',
                error: error.message
            });
        }
    }
});


app.options('/api/stream/*', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Range');
    res.status(200).send();
});


// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        status: 500,
        success: 'false',
        creator: 'GiftedTech',
        message: 'Internal server error',
        error: err.message
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        status: 404,
        success: 'false',
        creator: 'GiftedTech',
        message: 'Endpoint not found',
        availableEndpoints: [
            'GET /api/homepage',
            'GET /api/trending',
            'GET /api/search/:query',
            'GET /api/info/:movieId',
            'GET /api/sources/:movieId',
            'GET /api/download/*',
            'GET /api/stream/*' // Added new endpoint to the list
        ]
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`MovieBox API Server running on http://0.0.0.0:${PORT}`);
});

module.exports = app;