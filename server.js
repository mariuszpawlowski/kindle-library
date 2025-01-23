const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Constants
const COVERS_CACHE_DIR = path.join(__dirname, 'public', 'covers');
const DATA_DIR = path.join(__dirname, 'data');
const EXCLUDED_CLIPPINGS_PATH = path.join(DATA_DIR, 'excluded-clippings.csv');

// Ensure directories exist
[COVERS_CACHE_DIR, DATA_DIR].forEach(dir => {
    if (!fsSync.existsSync(dir)) {
        fsSync.mkdirSync(dir, { recursive: true });
    }
});

// Helper Functions
async function safeFileOperation(operation, fallback = null) {
    try {
        return await operation();
    } catch (error) {
        console.error('File operation failed:', error);
        return fallback;
    }
}

async function ensureFileExists(filePath, headers) {
    return await safeFileOperation(async () => {
        if (!fsSync.existsSync(filePath)) {
            await fs.writeFile(filePath, headers + '\n');
            console.log(`Created file: ${filePath}`);
        }
    });
}

// Cache management functions
function generateCacheFilename(title, author) {
    const hash = crypto.createHash('md5').update(`${title}${author}`).digest('hex');
    return `${hash}.jpg`;
}

async function getCachedCover(title, author) {
    const filename = generateCacheFilename(title, author);
    const cachePath = path.join(COVERS_CACHE_DIR, filename);
    try {
        await fs.access(cachePath);
        return `/covers/${filename}`;
    } catch {
        return null;
    }
}

async function saveCoverToCache(imageData, title, author) {
    const filename = generateCacheFilename(title, author);
    const cachePath = path.join(COVERS_CACHE_DIR, filename);
    try {
        await fs.writeFile(cachePath, imageData);
        return `/covers/${filename}`;
    } catch (error) {
        console.error('Error saving cover to cache:', error);
        return null;
    }
}

// Cover download functions
async function tryAmazonCover(amazonId) {
    if (!amazonId) return null;

    const urlPatterns = [
        `https://images-na.ssl-images-amazon.com/images/P/${amazonId}.01.L.jpg`,
        `https://m.media-amazon.com/images/P/${amazonId}.01.L.jpg`,
        `https://images-amazon.com/images/P/${amazonId}.01.LZZZZZZZ.jpg`
    ];

    for (const url of urlPatterns) {
        try {
            console.log(`Trying Amazon URL: ${url}`);
            const response = await axios({
                url,
                responseType: 'arraybuffer',
                timeout: 5000,
                validateStatus: (status) => status === 200
            });

            if (response.data.length > 1000) {
                console.log(`Successfully found Amazon cover: ${url}`);
                return response.data;
            }
        } catch (error) {
            continue;
        }
    }
    return null;
}

async function tryOpenLibrary(title, author) {
    try {
        // Clean and normalize the title and author
        const cleanTitle = title.replace(/[^\w\s]/g, ' ').trim();
        const cleanAuthor = author.replace(/[^\w\s]/g, ' ').trim();
        
        console.log(`Trying OpenLibrary for: "${cleanTitle}" by "${cleanAuthor}"`);
        const query = encodeURIComponent(`${cleanTitle} ${cleanAuthor}`);
        const searchUrl = `https://openlibrary.org/search.json?q=${query}`;

        const response = await axios.get(searchUrl, {
            timeout: 5000,
            headers: {
                'User-Agent': 'Kindle Library/1.0 (Educational Purpose)'
            }
        });

        if (response.data.docs && response.data.docs.length > 0) {
            const bookData = response.data.docs[0];
            const coverId = bookData.cover_i;

            if (coverId) {
                const coverUrl = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
                const imageResponse = await axios({
                    url: coverUrl,
                    responseType: 'arraybuffer',
                    timeout: 5000
                });

                return imageResponse.data;
            }
        }
        return null;
    } catch (error) {
        console.log(`OpenLibrary attempt failed for ${title}:`, error.message);
        return null;
    }
}

// Main cover download function
async function downloadAndCacheCover(title, author, amazonId) {
    try {
        // 1. Try Amazon
        if (amazonId) {
            const amazonCover = await tryAmazonCover(amazonId);
            if (amazonCover) return amazonCover;
        }

        // 2. Try OpenLibrary
        const openLibraryCover = await tryOpenLibrary(title, author);
        if (openLibraryCover) return openLibraryCover;

        return null;
    } catch (error) {
        console.error(`Error downloading cover for ${title}:`, error.message);
        return null;
    }
}

async function readExcludedClippings() {
    try {
        if (!fsSync.existsSync(EXCLUDED_CLIPPINGS_PATH)) {
            console.log('excluded-clippings.csv does not exist, creating new file');
            await fs.writeFile(EXCLUDED_CLIPPINGS_PATH, 'book_title,highlight_text\n');
            return new Set();
        }

        const content = await fs.readFile(EXCLUDED_CLIPPINGS_PATH, 'utf8');
        console.log('Raw content of excluded-clippings.csv:', content);

        if (!content.trim()) {
            console.log('File is empty (or only contains whitespace)');
            return new Set();
        }

        const records = parse(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });

        console.log('Parsed records:', records);

        const excludedSet = new Set();
        records.forEach(record => {
            const key = `${record.book_title.toLowerCase()}|${record.highlight_text.toLowerCase()}`;
            console.log('Adding exclusion key:', key);
            excludedSet.add(key);
        });

        console.log(`Total excluded highlights loaded: ${excludedSet.size}`);
        return excludedSet;
    } catch (error) {
        console.error('Error reading excluded clippings:', error);
        console.error('Full error details:', {
            message: error.message,
            stack: error.stack,
            path: EXCLUDED_CLIPPINGS_PATH
        });
        return new Set();
    }
}

async function readExcludeList() {
    return await safeFileOperation(async () => {
        const content = await fs.readFile(path.join(DATA_DIR, 'exclude.csv'), 'utf8');
        const records = parse(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });
        return new Set(records.map(record => 
            `${record.title.toLowerCase()}|${record.author.toLowerCase()}`
        ));
    }, new Set());
}

// Main parsing function
async function parseClippings() {
    try {
        const [excludeList, excludedClippings] = await Promise.all([
            readExcludeList(),
            readExcludedClippings()
        ]);
        
        const content = await fs.readFile(path.join(DATA_DIR, 'My Clippings.txt'), 'utf8');
        const entries = content.split('==========');
        const books = new Map();

        for (const entry of entries) {
            const lines = entry.trim().split('\n');
            if (lines.length < 4) continue;

            const titleLine = lines[0];
            const match = titleLine.match(/(.*?)\((.*?)\)/);
            
            if (match) {
                const title = match[1].trim();
                const author = match[2].trim();
                const highlightText = lines[3].trim();
                
                const bookKey = `${title.toLowerCase()}|${author.toLowerCase()}`;
                if (excludeList.has(bookKey)) continue;

                const highlightKey = `${title.toLowerCase()}|${highlightText.toLowerCase()}`;
                if (excludedClippings.has(highlightKey)) {
                    console.log(`Skipping excluded highlight: ${highlightKey}`);
                    continue;
                }

                if (!books.has(title)) {
                    const amazonId = (lines[1].match(/ASIN:\s*([A-Z0-9]{10})/) || [])[1];
                    
                    books.set(title, {
                        id: crypto.createHash('md5').update(`${title}${author}`).digest('hex'),
                        title,
                        author,
                        amazonId,
                        cover_image: null,
                        highlights: []
                    });
                }

                const book = books.get(title);
                book.highlights.push({
                    id: crypto.createHash('md5').update(highlightText).digest('hex'),
                    text: highlightText,
                    metadata: lines[1].trim()
                        .replace('Your Highlight on', '')
                        .replace('- Your Highlight on', '')
                        .trim()
                });
            }
        }

        const booksArray = Array.from(books.values());

        // Process covers
        await Promise.all(
            booksArray.map(async (book) => {
                try {
                    let coverUrl = await getCachedCover(book.title, book.author);
                    if (coverUrl) {
                        book.cover_image = coverUrl;
                        return;
                    }

                    const imageData = await downloadAndCacheCover(book.title, book.author, book.amazonId);
                    if (imageData) {
                        book.cover_image = await saveCoverToCache(imageData, book.title, book.author);
                    }
                } catch (error) {
                    console.error(`Error processing cover for ${book.title}:`, error);
                }
            })
        );

        return booksArray;
    } catch (error) {
        console.error('Error parsing clippings:', error);
        return [];
    }
}

// API Routes
app.get('/api/books', async (req, res) => {
    try {
        const books = await parseClippings();
        res.json(books);
    } catch (error) {
        res.status(500).json({ error: 'Error processing books' });
    }
});

app.post('/api/exclude-highlight', async (req, res) => {
    try {
        const { bookTitle, highlightText } = req.body;
        
        console.log('Attempting to exclude highlight:', { bookTitle, highlightText });

        if (!bookTitle || !highlightText) {
            console.log('Missing required fields');
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Create the file with headers if it doesn't exist
        if (!fsSync.existsSync(EXCLUDED_CLIPPINGS_PATH)) {
            console.log('Creating new excluded-clippings.csv file');
            await fs.writeFile(EXCLUDED_CLIPPINGS_PATH, 'book_title,highlight_text\n');
        }

        // Read current content
        const currentContent = await fs.readFile(EXCLUDED_CLIPPINGS_PATH, 'utf8');
        console.log('Current file content:', currentContent);

        // Prepare the new line
        const escapedTitle = bookTitle.replace(/"/g, '""').trim();
        const escapedText = highlightText.replace(/"/g, '""').trim();
        const newLine = `"${escapedTitle}","${escapedText}"\n`;

        // Append the new line
        await fs.appendFile(EXCLUDED_CLIPPINGS_PATH, newLine);
        
        // Verify the file was updated
        const updatedContent = await fs.readFile(EXCLUDED_CLIPPINGS_PATH, 'utf8');
        console.log('Updated file content:', updatedContent);

        res.json({ success: true });
    } catch (error) {
        console.error('Error excluding highlight:', error);
        console.error('Full error details:', {
            message: error.message,
            stack: error.stack,
            path: EXCLUDED_CLIPPINGS_PATH
        });
        res.status(500).json({ error: 'Error excluding highlight' });
    }
});

// Add this endpoint for excluding books
app.post('/api/exclude-book', async (req, res) => {
    try {
        const { title, author } = req.body;
        
        if (!title || !author) {
            return res.status(400).json({ error: 'Missing title or author' });
        }

        const filePath = path.join(DATA_DIR, 'exclude.csv');
        
        // Ensure file exists with headers
        if (!fsSync.existsSync(filePath)) {
            await fs.writeFile(filePath, 'title,author\n');
        }

        // Prepare CSV line
        const escapedTitle = title.replace(/"/g, '""').trim();
        const escapedAuthor = author.replace(/"/g, '""').trim();
        const newLine = `"${escapedTitle}","${escapedAuthor}"\n`;
        
        await fs.appendFile(filePath, newLine);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error excluding book:', error);
        res.status(500).json({ error: 'Error excluding book' });
    }
});

// Add endpoint to get excluded books
app.get('/api/excluded-books', async (req, res) => {
    try {
        const filePath = path.join(DATA_DIR, 'exclude.csv');
        
        if (!fsSync.existsSync(filePath)) {
            return res.json([]);
        }

        const content = await fs.readFile(filePath, 'utf8');
        const records = parse(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });
        
        res.json(records);
    } catch (error) {
        console.error('Error getting excluded books:', error);
        res.status(500).json({ error: 'Error getting excluded books' });
    }
});

// Initialize server
(async () => {
    try {
        await ensureFileExists(EXCLUDED_CLIPPINGS_PATH, 'book_title,highlight_text');
        console.log('Server initialized, excluded-clippings.csv ready');
    } catch (error) {
        console.error('Error during server initialization:', error);
    }
})();

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});