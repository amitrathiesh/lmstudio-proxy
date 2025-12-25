#!/usr/bin/env node

/**
 * LMStudio Proxy Server with Automatic Base64 Image Conversion
 * 
 * This proxy server sits between AI coding assistants (KiloCode, Cline, etc.)
 * and LMStudio, automatically converting image file paths/URLs to base64 data URIs.
 * 
 * @author Amit Rathiesh <amitrathiesh@webzler.com>
 * @website https://www.webzler.com
 */

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { readFile } from 'fs/promises';
import { extname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
import sharp from 'sharp';

// Configuration
const PROXY_PORT = process.env.PROXY_PORT || 1235;
const LMSTUDIO_URL = process.env.LMSTUDIO_URL || 'http://localhost:1234';
const DEBUG = process.env.DEBUG === 'true';

// MIME type mapping for common image formats
const MIME_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
};

/**
 * Convert an image file to a base64 data URI
 */
async function convertImageToBase64(imagePath) {
    try {
        const imageBuffer = await readFile(imagePath);
        const ext = extname(imagePath).toLowerCase();
        const mimeType = MIME_TYPES[ext];

        if (!mimeType) {
            throw new Error(`Unsupported image format: ${ext}`);
        }

        const base64Image = imageBuffer.toString('base64');
        return `data:${mimeType};base64,${base64Image}`;
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Image file not found: ${imagePath}`);
        }
        throw error;
    }
}

/**
 * Check if a string is a file path (not a URL or data URI)
 */
function isFilePath(str) {
    if (!str || typeof str !== 'string') return false;
    // Skip if already a data URI
    if (str.startsWith('data:')) return false;
    // Skip if it's an HTTP(S) URL
    if (str.startsWith('http://') || str.startsWith('https://')) return false;
    // Check if it looks like a file path or file URL
    return isAbsolute(str) || str.startsWith('./') || str.startsWith('../') || str.startsWith('file://');
}

/**
 * Process request body to convert image paths to base64
 */
async function processRequestBody(body) {
    if (!body || typeof body !== 'object') return body;

    // Clone the body to avoid modifying the original
    const processedBody = JSON.parse(JSON.stringify(body));

    // Check for OpenAI-compatible chat completion format
    if (processedBody.messages && Array.isArray(processedBody.messages)) {
        for (const message of processedBody.messages) {
            if (message.content && Array.isArray(message.content)) {
                for (const contentItem of message.content) {
                    // Check for image_url type content
                    if (contentItem.type === 'image_url' && contentItem.image_url) {
                        const imageUrl = contentItem.image_url.url || contentItem.image_url;

                        // If it's a file path, convert to base64
                        if (isFilePath(imageUrl)) {
                            if (DEBUG) {
                                console.log(`[PROXY] Converting image: ${imageUrl}`);
                            }

                            try {
                                let filePath = imageUrl;
                                if (filePath.startsWith('file://')) {
                                    try {
                                        filePath = fileURLToPath(filePath);
                                    } catch (e) {
                                        filePath = filePath.replace('file://', '');
                                    }
                                }

                                const base64Uri = await convertImageToBase64(filePath);

                                // Update the URL with base64 data URI
                                if (typeof contentItem.image_url === 'string') {
                                    contentItem.image_url = base64Uri;
                                } else {
                                    contentItem.image_url.url = base64Uri;
                                }

                                if (DEBUG) {
                                    console.log(`[PROXY] ✅ Converted to base64 (${base64Uri.length} chars)`);
                                }
                            } catch (error) {
                                console.error(`[PROXY] ❌ Failed to convert image: ${error.message}`);
                                // Continue with original path - let LMStudio handle the error
                            }
                        } else if (imageUrl.startsWith('data:')) {
                            // Check if it's WebP which LMStudio might reject
                            if (imageUrl.startsWith('data:image/webp')) {
                                if (DEBUG) {
                                    console.log(`[PROXY] ⚠️ Detected WebP format. Converting to PNG for LMStudio compatibility...`);
                                }

                                try {
                                    // Strip the prefix to get just base64 data
                                    const base64Data = imageUrl.replace(/^data:image\/webp;base64,/, "");
                                    const buffer = Buffer.from(base64Data, 'base64');

                                    // Use Sharp to convert buffer to PNG
                                    const pngBuffer = await sharp(buffer)
                                        .png()
                                        .toBuffer();

                                    const pngBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;

                                    // Update content with new PNG data
                                    if (typeof contentItem.image_url === 'string') {
                                        contentItem.image_url = pngBase64;
                                    } else {
                                        contentItem.image_url.url = pngBase64;
                                    }

                                    if (DEBUG) {
                                        console.log(`[PROXY] ✅ Successfully converted WebP -> PNG (${pngBase64.length} chars)`);
                                    }
                                } catch (err) {
                                    console.error(`[PROXY] ❌ Failed to convert WebP to PNG: ${err.message}`);
                                    // Fallback: pass through original
                                }
                            } else {
                                // It's already a data URI (likely PNG/JPEG), just ensure structure
                                if (typeof contentItem.image_url === 'string') {
                                    if (DEBUG) {
                                        console.log(`[PROXY] 🔧 Fixing structure: Transforming string image_url to object`);
                                    }
                                    contentItem.image_url = { url: imageUrl };
                                }

                                if (DEBUG) {
                                    console.log(`[PROXY] ℹ️ Passing through existing data URI (${imageUrl.substring(0, 30)}...)`);
                                }
                            }
                        } else if (DEBUG) {
                            console.log(`[PROXY] ⚠️ Skipping image URL (not a local file): ${imageUrl}`);
                        }
                    }
                }
            }
        }
    }

    return processedBody;
}

// Create Express app
const app = express();

// Parse JSON bodies
app.use(express.json({ limit: '50mb' }));

// Custom middleware to intercept and modify requests
app.use(async (req, res, next) => {
    if (req.method === 'POST' && req.body) {
        try {
            req.body = await processRequestBody(req.body);
        } catch (error) {
            console.error('[PROXY] Error processing request:', error);
        }
    }
    next();
});

// Proxy all requests to LMStudio
app.use('/', createProxyMiddleware({
    target: LMSTUDIO_URL,
    changeOrigin: true,
    onProxyReq: (proxyReq, req, res) => {
        // DEBUG: Log the structure to see what KiloCode is sending
        if (DEBUG && req.body) {
            console.log(`[PROXY] 📨 Received ${req.method} request to ${req.url}`);
            if (req.body.messages) {
                console.log(`[PROXY] 📦 Messages count: ${req.body.messages.length}`);
                const lastMsg = req.body.messages[req.body.messages.length - 1];
                const contentTypes = lastMsg.content && Array.isArray(lastMsg.content)
                    ? lastMsg.content.map(c => c.type).join(', ')
                    : 'not-array-or-undefined';
                console.log(`[PROXY] 🔍 Last message content types: ${contentTypes}`);
            }
        }

        // Rewrite the body if it was modified
        if (req.body) {
            const bodyData = JSON.stringify(req.body);
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
            proxyReq.end();
        }
    },
    onError: (err, req, res) => {
        console.error('[PROXY] Proxy error:', err);
        res.status(500).json({
            error: 'Proxy error',
            message: err.message,
        });
    },
}));

// Graceful shutdown
function gracefulShutdown() {
    console.log('[PROXY] Received shutdown signal, closing server...');
    process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Start the server
app.listen(PROXY_PORT, () => {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║   LMStudio Proxy Server - Base64 Image Converter          ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`✅ Proxy server running on: http://localhost:${PROXY_PORT}`);
    console.log(`🎯 Forwarding requests to: ${LMSTUDIO_URL}`);
    console.log('');
    console.log('📝 Configure your AI assistant to use:');
    console.log(`   http://localhost:${PROXY_PORT}`);
    console.log('');
    console.log('🔄 Images will be automatically converted to base64');
    console.log('');
    if (DEBUG) {
        console.log('🐛 Debug mode: ON');
        console.log('Press Ctrl+C to stop');
    }
    console.log('────────────────────────────────────────────────────────────');
});
