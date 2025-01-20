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

async function readExcludedClippings() {
    try {
        const content = await fs.readFile(path.join(__dirname, 'data', 'excluded-clippings.csv'), 'utf8');
        const records = parse(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });
        
        // Create a Set of "book_title|highlight_text" for faster lookup
        return new Set(records.map(record => 
            `${record.book_title.toLowerCase()}|${record.highlight_text.toLowerCase()}`
        ));
    } catch (error) {
        console.error('Error reading excluded clippings:', error);
        return new Set();
    }
}

async function parseClippings() {
    try {
        const excludeList = await readExcludeList();
        const excludedClippings = await readExcludedClippings();
        
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
                const highlightText = lines[3].trim();
                
                // Check if book is excluded
                const bookKey = `${title.toLowerCase()}|${author.toLowerCase()}`;
                if (excludeList.has(bookKey)) {
                    continue;
                }

                // Check if highlight is excluded
                const highlightKey = `${title.toLowerCase()}|${highlightText.toLowerCase()}`;
                if (excludedClippings.has(highlightKey)) {
                    continue;
                }

                const metadata = lines[1].trim()
                    .replace('Your Highlight on', '')
                    .replace('- Your Highlight on', '')
                    .trim();

                if (!books.has(title)) {
                    const amazonId = await extractAmazonId(metadata);
                    const bookId = Buffer.from(`${title}${author}`).toString('base64').replace(/[/+=]/g, '_');

                    let coverUrl = await getAmazonCoverUrl(amazonId);
                    if (!coverUrl) {
                        coverUrl = await getOpenLibraryCover(title, author);
                    }

                    books.set(title, {
                        id: bookId,
                        title,
                        author,
                        amazonId,
                        cover_image: coverUrl,
                        highlights: []
                    });
                }

                const book = books.get(title);
                book.highlights.push({
                    id: Buffer.from(highlightText).toString('base64').replace(/[/+=]/g, '_'),
                    text: highlightText,
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

// Add new endpoint to exclude individual highlights
app.post('/api/exclude-highlight', async (req, res) => {
    try {
        const { bookTitle, highlightText } = req.body;
        const newLine = `\n"${bookTitle}","${highlightText}"`;
        
        await fs.appendFile(
            path.join(__dirname, 'data', 'excluded-clippings.csv'),
            newLine
        );
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error excluding highlight' });
    }
});

// Add endpoint to get excluded highlights
app.get('/api/excluded-highlights', async (req, res) => {
    try {
        const content = await fs.readFile(path.join(__dirname, 'data', 'excluded-clippings.csv'), 'utf8');
        const records = parse(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });
        res.json(records);
    } catch (error) {
        res.status(500).json({ error: 'Error reading excluded highlights' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});