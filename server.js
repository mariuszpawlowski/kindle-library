const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const { parse } = require('csv-parse/sync');
const axios = require('axios');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

async function extractAmazonId(metadata) {
    const asinMatch = metadata.match(/ASIN:\s*([A-Z0-9]{10})/);
    return asinMatch ? asinMatch[1] : null;
}

async function getAmazonCoverUrl(amazonId) {
    if (!amazonId) return null;
    
    const urlPatterns = [
        `https://images-na.ssl-images-amazon.com/images/P/${amazonId}.01.L.jpg`,
        `https://m.media-amazon.com/images/P/${amazonId}.01.L.jpg`
    ];

    for (const url of urlPatterns) {
        try {
            const response = await axios.head(url);
            if (response.status === 200) {
                return url;
            }
        } catch (error) {
            continue;
        }
    }
    return null;
}

async function getOpenLibraryCover(title, author) {
    try {
        const query = encodeURIComponent(`${title} ${author}`);
        const url = `https://openlibrary.org/search.json?q=${query}`;
        
        const response = await axios.get(url);
        if (response.data.docs && response.data.docs.length > 0) {
            const bookData = response.data.docs[0];
            const coverId = bookData.cover_i;
            
            return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null;
        }
        return null;
    } catch (error) {
        console.error(`Error fetching OpenLibrary data for ${title}:`, error);
        return null;
    }
}

async function readExcludeList() {
    try {
        const content = await fs.readFile(path.join(__dirname, 'data', 'exclude.csv'), 'utf8');
        const records = parse(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });
        
        return new Set(records.map(record => 
            `${record.title.toLowerCase()}|${record.author.toLowerCase()}`
        ));
    } catch (error) {
        console.error('Error reading exclude list:', error);
        return new Set();
    }
}

async function parseClippings() {
    try {
        const excludeList = await readExcludeList();
        
        const content = await fs.readFile(path.join(__dirname, 'data', 'My Clippings.txt'), 'utf8');
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
                
                const key = `${title.toLowerCase()}|${author.toLowerCase()}`;
                if (excludeList.has(key)) {
                    continue; // Skip excluded book
                }

                const metadata = lines[1].trim()
                    .replace('Your Highlight on', '')
                    .replace('- Your Highlight on', '')
                    .trim();

                if (!books.has(title)) {
                    const amazonId = await extractAmazonId(metadata);
                    let coverUrl = null;

                    // Try Amazon cover first
                    if (amazonId) {
                        coverUrl = await getAmazonCoverUrl(amazonId);
                    }

                    // If no Amazon cover, try OpenLibrary
                    if (!coverUrl) {
                        coverUrl = await getOpenLibraryCover(title, author);
                    }

                    books.set(title, {
                        title,
                        author,
                        amazonId,
                        cover_image: coverUrl,
                        highlights: []
                    });
                }

                const book = books.get(title);
                book.highlights.push({
                    text: lines[3].trim(),
                    metadata: metadata
                });
            }
        }

        return Array.from(books.values());
    } catch (error) {
        console.error('Error parsing clippings:', error);
        return [];
    }
}

app.get('/api/books', async (req, res) => {
    try {
        const books = await parseClippings();
        res.json(books);
    } catch (error) {
        res.status(500).json({ error: 'Error processing books' });
    }
});

app.get('/api/excluded-books', async (req, res) => {
    try {
        const content = await fs.readFile(path.join(__dirname, 'data', 'exclude.csv'), 'utf8');
        const records = parse(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });
        res.json(records);
    } catch (error) {
        res.status(500).json({ error: 'Error reading exclude list' });
    }
});

app.post('/api/exclude-book', async (req, res) => {
    try {
        const { title, author, reason } = req.body;
        const newLine = `\n"${title}","${author}","${reason}"`;
        
        await fs.appendFile(
            path.join(__dirname, 'data', 'exclude.csv'),
            newLine
        );
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error updating exclude list' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});