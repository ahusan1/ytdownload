const express = require('express');
const cors = require('cors');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Use Windows binary locally and Linux binary in containers/servers.
const ytDlpPath = process.platform === 'win32'
    ? path.join(__dirname, 'yt-dlp.exe')
    : '/usr/bin/yt-dlp';
let ytDlpWrap;

// Download yt-dlp binary if not exists
async function initializeYtDlp() {
    if (process.platform === 'win32' && !fs.existsSync(ytDlpPath)) {
        console.log('Downloading yt-dlp binary...');
        await YTDlpWrap.downloadFromGithub(ytDlpPath);
        console.log('yt-dlp downloaded successfully!');
    }

    if (!fs.existsSync(ytDlpPath)) {
        throw new Error(`yt-dlp binary not found at ${ytDlpPath}`);
    }

    ytDlpWrap = new YTDlpWrap(ytDlpPath);
    console.log('yt-dlp initialized!');
}

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Get video info endpoint
app.post('/download', async (req, res) => {
    try {
        const { url, quality } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Get video info using yt-dlp
        const info = await ytDlpWrap.getVideoInfo(url);

        // Format duration
        const duration = formatDuration(info.duration || 0);

        res.json({
            title: info.title || 'Unknown',
            duration: duration,
            quality: quality,
            success: true
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to fetch video information: ' + error.message });
    }
});

// Download video endpoint
app.get('/download-file', async (req, res) => {
    try {
        const { url, quality } = req.query;

        console.log('Download request for:', url, 'Quality:', quality);

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Get video info first
        const info = await ytDlpWrap.getVideoInfo(url);
        const title = (info.title || 'video').replace(/[^\w\s-]/gi, '').substring(0, 100);
        const safeBaseName = title.trim().replace(/\s+/g, '_') || `video_${Date.now()}`;
        const downloadsDir = path.join(__dirname, 'downloads');
        const outputPath = path.join(downloadsDir, `${safeBaseName}.mp4`);

        console.log('Video title:', title);

        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
        }

        // Determine quality format
        let format = 'best[ext=mp4]/best';
        switch (quality) {
            case '1080p':
                format = 'best[height<=1080][ext=mp4]/best[height<=1080]/best';
                break;
            case '720p':
                format = 'best[height<=720][ext=mp4]/best[height<=720]/best';
                break;
            case '480p':
                format = 'best[height<=480][ext=mp4]/best[height<=480]/best';
                break;
            case '360p':
                format = 'best[height<=360][ext=mp4]/best[height<=360]/best';
                break;
            case 'highest':
            default:
                format = 'best[ext=mp4]/best';
        }

        console.log('Using format:', format);

        // Download to temp file first; this is more stable for mobile browsers.
        await ytDlpWrap.execPromise([
            url,
            '-f', format,
            '-o', outputPath,
            '--no-warnings',
            '--no-playlist'
        ]);

        res.download(outputPath, `${title}.mp4`, (downloadError) => {
            if (downloadError) {
                console.error('Send file error:', downloadError);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to send downloaded file' });
                }
            }

            fs.unlink(outputPath, (unlinkError) => {
                if (unlinkError) {
                    console.error('Cleanup error:', unlinkError.message);
                }
            });

            if (!downloadError) {
                console.log('Download completed successfully');
            }
        });

    } catch (error) {
        console.error('Download error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Download failed: ' + error.message });
        }
    }
});

// Helper function to format duration
function formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

app.listen(PORT, async () => {
    try {
        console.log('Starting server...');
        await initializeYtDlp();
        console.log(`
YouTube Downloader Server Running
Server: http://localhost:${PORT}
Status: Ready to download videos
Workspace: ${__dirname}
Press Ctrl+C to stop the server
        `);
    } catch (startupError) {
        console.error('Startup failed:', startupError.message);
        process.exit(1);
    }
});
