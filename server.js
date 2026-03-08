const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.post('/youtube-info', async (req, res) => {
    try {
        const apiKey = process.env.YOUTUBE_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'YOUTUBE_API_KEY is not configured on server.' });
        }

        const { url } = req.body;
        const videoId = extractYouTubeVideoId(url);
        if (!videoId) {
            return res.status(400).json({ error: 'Invalid YouTube video URL.' });
        }

        const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${videoId}&key=${apiKey}`;
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!response.ok) {
            return res.status(400).json({ error: data.error?.message || 'YouTube API request failed.' });
        }

        const item = data.items && data.items[0];
        if (!item) {
            return res.status(404).json({ error: 'Video not found.' });
        }

        const snippet = item.snippet || {};
        const statistics = item.statistics || {};
        const durationIso = item.contentDetails?.duration || 'PT0S';

        res.json({
            title: snippet.title || 'Unknown',
            channelTitle: snippet.channelTitle || 'Unknown',
            publishedAt: snippet.publishedAt || '',
            duration: formatYouTubeDuration(durationIso),
            viewCount: statistics.viewCount || '0',
            likeCount: statistics.likeCount || '0',
            thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '',
            videoId
        });
    } catch (error) {
        console.error('youtube-info error:', error.message);
        res.status(500).json({ error: 'Failed to fetch video information.' });
    }
});

function extractYouTubeVideoId(input) {
    if (!input || typeof input !== 'string') {
        return null;
    }

    let parsed;
    try {
        parsed = new URL(input.trim());
    } catch {
        return null;
    }

    const host = parsed.hostname.toLowerCase();

    if (host === 'youtu.be') {
        return parsed.pathname.slice(1) || null;
    }

    if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') {
        if (parsed.pathname === '/watch') {
            return parsed.searchParams.get('v');
        }

        if (parsed.pathname.startsWith('/shorts/')) {
            return parsed.pathname.split('/')[2] || null;
        }

        if (parsed.pathname.startsWith('/embed/')) {
            return parsed.pathname.split('/')[2] || null;
        }
    }

    return null;
}

function formatYouTubeDuration(isoDuration) {
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) {
        return '0:00';
    }

    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
