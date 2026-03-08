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

app.post('/download', async (req, res) => {
    try {
        const { url } = req.body;

        const parsed = parseAndValidateUrl(url);
        if (!parsed.ok) {
            return res.status(400).json({ error: parsed.error });
        }

        const upstream = await fetch(parsed.value, {
            method: 'HEAD',
            redirect: 'follow'
        });

        if (!upstream.ok) {
            return res.status(400).json({ error: 'Could not reach file URL' });
        }

        const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
        const contentLength = upstream.headers.get('content-length') || 'Unknown';
        const fileName = inferFileName(parsed.value, upstream.headers.get('content-disposition'));

        res.json({
            title: fileName,
            duration: contentLength === 'Unknown' ? 'Unknown size' : formatBytes(Number(contentLength)),
            quality: 'Original',
            mime: contentType,
            success: true
        });
    } catch (error) {
        console.error('Metadata error:', error.message);
        res.status(500).json({ error: 'Failed to fetch file information' });
    }
});

app.get('/download-file', async (req, res) => {
    try {
        const rawUrl = req.query.url;
        const parsed = parseAndValidateUrl(rawUrl);
        if (!parsed.ok) {
            return res.status(400).json({ error: parsed.error });
        }

        const upstream = await fetch(parsed.value, {
            method: 'GET',
            redirect: 'follow'
        });

        if (!upstream.ok || !upstream.body) {
            return res.status(400).json({ error: 'Failed to download from source URL' });
        }

        const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
        const fileName = inferFileName(parsed.value, upstream.headers.get('content-disposition'));

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        const reader = upstream.body.getReader();

        const pump = async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    res.end();
                    break;
                }
                res.write(Buffer.from(value));
            }
        };

        pump().catch((streamError) => {
            console.error('Stream error:', streamError.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Streaming failed' });
            } else {
                res.end();
            }
        });
    } catch (error) {
        console.error('Download error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Download failed' });
        }
    }
});

function parseAndValidateUrl(urlValue) {
    if (!urlValue || typeof urlValue !== 'string') {
        return { ok: false, error: 'URL is required' };
    }

    let parsed;
    try {
        parsed = new URL(urlValue);
    } catch {
        return { ok: false, error: 'Invalid URL' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: 'Only http/https URLs are allowed' };
    }

    return { ok: true, value: parsed.toString() };
}

function inferFileName(urlValue, contentDisposition) {
    const cd = contentDisposition || '';
    const utfMatch = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (utfMatch && utfMatch[1]) {
        return sanitizeFileName(decodeURIComponent(utfMatch[1]));
    }

    const plainMatch = cd.match(/filename="?([^";]+)"?/i);
    if (plainMatch && plainMatch[1]) {
        return sanitizeFileName(plainMatch[1]);
    }

    try {
        const pathname = new URL(urlValue).pathname;
        const base = pathname.split('/').pop() || 'download.bin';
        return sanitizeFileName(base);
    } catch {
        return 'download.bin';
    }
}

function sanitizeFileName(name) {
    return name.replace(/[<>:"/\\|?*]+/g, '_').slice(0, 120) || 'download.bin';
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return 'Unknown size';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let idx = 0;
    while (size >= 1024 && idx < units.length - 1) {
        size /= 1024;
        idx += 1;
    }
    return `${size.toFixed(1)} ${units[idx]}`;
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
