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

        console.log('Video title:', title);

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

        // Stream directly to client so hosted platforms do not time out waiting for file preparation.
        const ytDlpProcess = ytDlpWrap.exec([
            url,
            '-f', format,
            '-o', '-',
            '--no-warnings',
            '--no-playlist'
        ]);

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${title}.mp4"`);

        let stderrBuffer = '';

        ytDlpProcess.stderr.on('data', (chunk) => {
            if (stderrBuffer.length < 3000) {
                stderrBuffer += chunk.toString();
            }
        });

        ytDlpProcess.stdout.pipe(res);

        ytDlpProcess.on('close', (code) => {
            if (code === 0) {
                console.log('Download completed successfully');
                return;
            }

            console.error('yt-dlp exited with code:', code, stderrBuffer.trim());
            if (!res.headersSent) {
                res.status(500).json({ error: 'Download failed on server' });
            } else {
                res.end();
            }
        });

        ytDlpProcess.on('error', (processError) => {
            console.error('yt-dlp process error:', processError.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Download process failed' });
            } else {
                res.end();
            }
        });

        req.on('close', () => {
            if (!ytDlpProcess.killed) {
                ytDlpProcess.kill('SIGTERM');
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
