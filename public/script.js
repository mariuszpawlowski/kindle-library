class BookLibrary {
    constructor() {
        this.bookGrid = document.getElementById('bookGrid');
        this.highlightsModal = document.getElementById('highlightsModal');
        this.exclusionsModal = document.getElementById('exclusionsModal');
        this.defaultCover = '/images/default-cover.jpg';
        this.currentBooks = []; // Add this to store current books
        this.setupModals();
        this.setupExclusionsUI();
        this.init();
        this.debouncedRefresh = this.debounce(this.refreshBookList.bind(this), 2000);
    }


    // Add debounce utility
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    setupModals() {
        // Setup highlights modal
        this.highlightsModal.querySelector('.close').onclick = () => {
            this.highlightsModal.style.display = 'none';
        };

        // Setup exclusions modal
        this.exclusionsModal.querySelector('.close').onclick = () => {
            this.exclusionsModal.style.display = 'none';
        };

        window.onclick = (event) => {
            if (event.target === this.highlightsModal) {
                this.highlightsModal.style.display = 'none';
            }
            if (event.target === this.exclusionsModal) {
                this.exclusionsModal.style.display = 'none';
            }
        };
    }

    async loadExcludedBooks() {
        try {
            const response = await fetch('/api/excluded-books');
            const books = await response.json();
            
            const list = document.getElementById('excludedBooksList');
            if (list) {
                list.innerHTML = books.map(book => `
                    <div class="excluded-book">
                        <h4>${book.title}</h4>
                        <p>Author: ${book.author}</p>
                    </div>
                `).join('');
            }
        } catch (error) {
            console.error('Error loading excluded books:', error);
        }
    }

    setupExclusionsUI() {
        const showExclusionsBtn = document.getElementById('showExclusions');
        const addBtn = document.getElementById('addExclusion');

        showExclusionsBtn.onclick = () => {
            this.loadExcludedBooks();
            this.exclusionsModal.style.display = 'block';
        };

        addBtn.onclick = () => this.addBookToExcludeList();
    }

    async init() {
        try {
            this.bookGrid.innerHTML = '<div class="loading"></div>';
            const response = await fetch('/api/books');
            const books = await response.json();
            this.currentBooks = books;
            console.log(`Loaded ${books.length} books`);
            this.displayBooks(books);
        } catch (error) {
            console.error('Error:', error);
            this.bookGrid.innerHTML = '<div class="error">Error loading books</div>';
        }
    }

    async refreshBookList() {
        try {
            const response = await fetch('/api/books');
            const books = await response.json();
            this.currentBooks = books;
            books.forEach(book => {
                const bookElement = document.querySelector(`[data-book-id="${book.id}"]`);
                if (bookElement) {
                    const countElement = bookElement.querySelector('.highlight-count');
                    if (countElement) {
                        countElement.textContent = 
                            `${book.highlights.length} highlight${book.highlights.length !== 1 ? 's' : ''}`;
                    }
                }
            });
        } catch (error) {
            console.error('Error refreshing books:', error);
        }
    }

    displayBooks(books) {
        this.bookGrid.innerHTML = '';
        books.forEach(book => {
            const bookElement = this.createBookElement(book);
            this.bookGrid.appendChild(bookElement);
        });
    }

    createBookElement(book) {
        const bookElement = document.createElement('div');
        bookElement.className = 'book-item';
        bookElement.setAttribute('data-book-id', book.id);
        
        const useDefaultCover = book.useDefaultCover || !book.cover_image;
        const coverUrl = useDefaultCover ? this.defaultCover : book.cover_image;
        
        bookElement.innerHTML = `
            <img src="${coverUrl}" 
                 alt="${book.title}" 
                 class="book-cover${useDefaultCover ? ' default-cover' : ' cached'}"
                 onerror="this.onerror=null; this.src='${this.defaultCover}'; this.classList.add('default-cover');">
            <h3 class="book-title">${book.title}</h3>
            <p class="book-author">${book.author}</p>
            <p class="highlight-count">${book.highlights.length} highlight${book.highlights.length !== 1 ? 's' : ''}</p>
        `;

        bookElement.onclick = () => this.showHighlights(book);
        
        return bookElement;
    }

    showHighlights(book) {
        const modalTitle = this.highlightsModal.querySelector('#modal-title');
        const modalAuthor = this.highlightsModal.querySelector('#modal-author');
        const modalCover = this.highlightsModal.querySelector('#modalCover');
        const modalHighlightCount = this.highlightsModal.querySelector('#modal-highlight-count');
        const highlightsContainer = this.highlightsModal.querySelector('#highlights-container');
        
        modalTitle.textContent = book.title;
        modalAuthor.textContent = book.author;
        modalCover.src = book.cover_image || this.defaultCover;
        modalCover.onerror = () => modalCover.src = this.defaultCover;
        modalHighlightCount.textContent = `${book.highlights.length} highlight${book.highlights.length !== 1 ? 's' : ''}`;
        
        highlightsContainer.innerHTML = '';

        book.highlights.forEach(highlight => {
            const highlightDiv = document.createElement('div');
            highlightDiv.className = 'highlight-item';
            highlightDiv.dataset.highlightId = highlight.id;
            
            highlightDiv.innerHTML = `
                <div class="highlight-content">
                    <blockquote>${highlight.text}</blockquote>
                    <small class="highlight-metadata">${highlight.metadata}</small>
                </div>
                <span class="exclude-highlight-icon">×</span>
            `;

            const excludeIcon = highlightDiv.querySelector('.exclude-highlight-icon');
            excludeIcon.onclick = async (e) => {
                e.stopPropagation();
                await this.excludeHighlight(book, highlight);
                // Schedule a background refresh
                this.debouncedRefresh();
            };

            highlightsContainer.appendChild(highlightDiv);
        });
        
        this.highlightsModal.style.display = 'block';
    }

    // Add refresh method
    async refreshBookList() {
        try {
            const response = await fetch('/api/books');
            const books = await response.json();
            this.currentBooks = books;
            // Only update the counts, don't rebuild the entire grid
            books.forEach(book => {
                const bookElement = document.querySelector(`[data-book-id="${book.id}"]`);
                if (bookElement) {
                    const countElement = bookElement.querySelector('.highlight-count');
                    if (countElement) {
                        countElement.textContent = 
                            `${book.highlights.length} highlight${book.highlights.length !== 1 ? 's' : ''}`;
                    }
                }
            });
        } catch (error) {
            console.error('Error refreshing books:', error);
        }
    }

async excludeHighlight(book, highlight) {
    try {
        // Start animation immediately for better UX
        const highlightElement = document.querySelector(`[data-highlight-id="${highlight.id}"]`);
        if (highlightElement) {
            highlightElement.style.opacity = '0';
            highlightElement.style.transform = 'translateX(20px)';
        }

        // Send request to server
        const response = await fetch('/api/exclude-highlight', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                bookTitle: book.title,
                highlightText: highlight.text
            })
        });

        if (!response.ok) {
            throw new Error('Failed to exclude highlight');
        }

        // Update UI without full refresh
        setTimeout(() => {
            if (highlightElement) {
                highlightElement.remove();

                // Update highlight count in modal
                const modalHighlightCount = document.getElementById('modal-highlight-count');
                const currentModalCount = document.querySelectorAll('.highlight-item').length;
                modalHighlightCount.textContent = 
                    `${currentModalCount} highlight${currentModalCount !== 1 ? 's' : ''}`;

                // Update count in main grid
                const bookElement = document.querySelector(`[data-book-id="${book.id}"]`);
                if (bookElement) {
                    const countElement = bookElement.querySelector('.highlight-count');
                    if (countElement) {
                        countElement.textContent = 
                            `${currentModalCount} highlight${currentModalCount !== 1 ? 's' : ''}`;
                    }
                }
            }
        }, 300);

        // Update internal data without refresh
        const bookIndex = this.currentBooks.findIndex(b => b.id === book.id);
        if (bookIndex !== -1) {
            this.currentBooks[bookIndex].highlights = 
                this.currentBooks[bookIndex].highlights.filter(h => h.id !== highlight.id);
        }

        return true;
    } catch (error) {
        console.error('Error excluding highlight:', error);
        // Revert animation if failed
        if (highlightElement) {
            highlightElement.style.opacity = '1';
            highlightElement.style.transform = 'none';
        }
        return false;
    }
}


    async setDefaultCover(title, author) {
        try {
            await fetch('/api/set-default-cover', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ title, author })
            });
        } catch (error) {
            console.error('Error setting default cover:', error);
        }
    }

 async addBookToExcludeList() {
        const title = document.getElementById('excludeTitle')?.value;
        const author = document.getElementById('excludeAuthor')?.value;

        if (!title || !author) {
            alert('Please enter both title and author');
            return;
        }

        try {
            const response = await fetch('/api/exclude-book', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ title, author })
            });

            if (!response.ok) {
                throw new Error('Failed to exclude book');
            }

            // Clear inputs
            if (document.getElementById('excludeTitle')) {
                document.getElementById('excludeTitle').value = '';
            }
            if (document.getElementById('excludeAuthor')) {
                document.getElementById('excludeAuthor').value = '';
            }

            // Refresh lists
            await this.loadExcludedBooks();
            await this.init();

            alert('Book excluded successfully');
        } catch (error) {
            console.error('Error adding book to exclude list:', error);
            alert('Failed to exclude book');
        }
    }
}

// Initialize when the page loads
window.addEventListener('load', () => {
    window.bookLibrary = new BookLibrary();
});