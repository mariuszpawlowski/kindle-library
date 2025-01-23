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
            this.currentBooks = books; // Store the books
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
            this.displayBooks(books);
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
            highlightDiv.innerHTML = `
                <blockquote>${highlight.text}</blockquote>
                <small class="highlight-metadata">${highlight.metadata}</small>
                <span class="exclude-highlight-icon">×</span>
            `;

            const excludeIcon = highlightDiv.querySelector('.exclude-highlight-icon');
            excludeIcon.onclick = async (e) => {
                e.stopPropagation();
                const success = await this.excludeHighlight(book, highlight);
                if (success) {
                    // Animate removal
                    highlightDiv.style.opacity = '0';
                    highlightDiv.style.transform = 'translateX(20px)';
                    setTimeout(() => {
                        highlightDiv.remove();
                        
                        // Update modal count
                        const currentCount = document.querySelectorAll('.highlight-item').length;
                        modalHighlightCount.textContent = 
                            `${currentCount} highlight${currentCount !== 1 ? 's' : ''}`;

                        // Update main page immediately
                        const bookElement = this.bookGrid.querySelector(`[data-book-id="${book.id}"]`);
                        if (bookElement) {
                            const countElement = bookElement.querySelector('.highlight-count');
                            if (countElement) {
                                countElement.textContent = 
                                    `${currentCount} highlight${currentCount !== 1 ? 's' : ''}`;
                            }
                        }
                    }, 300);
                }
            };

            highlightsContainer.appendChild(highlightDiv);
        });
        
        this.highlightsModal.style.display = 'block';
    }

    async excludeHighlight(book, highlight) {
        try {
            console.log('Excluding highlight:', { book: book.title, text: highlight.text });
            
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

            const result = await response.json();
            console.log('Server response:', result);

            if (!response.ok) {
                throw new Error(result.error || 'Failed to exclude highlight');
            }

            // Update UI for both modal and main page
            await this.refreshBookList();
            
            // Update the book object in currentBooks
            const updatedBook = this.currentBooks.find(b => b.title === book.title);
            if (updatedBook) {
                updatedBook.highlights = updatedBook.highlights.filter(h => h.text !== highlight.text);
            }

            return true;
        } catch (error) {
            console.error('Error excluding highlight:', error);
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
        const title = document.getElementById('excludeTitle').value;
        const author = document.getElementById('excludeAuthor').value;

        if (!title || !author) {
            alert('Please enter both title and author');
            return;
        }

        try {
            await fetch('/api/exclude-book', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ title, author })
            });

            // Clear inputs
            document.getElementById('excludeTitle').value = '';
            document.getElementById('excludeAuthor').value = '';

            // Refresh lists
            this.loadExcludedBooks();
            this.init();
        } catch (error) {
            console.error('Error adding book to exclude list:', error);
        }
    }
}

// Initialize when the page loads
window.addEventListener('load', () => {
    window.bookLibrary = new BookLibrary();
});