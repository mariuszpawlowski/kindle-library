class BookLibrary {
    constructor() {
        this.bookGrid = document.getElementById('bookGrid');
        this.highlightsModal = document.getElementById('highlightsModal');
        this.exclusionsModal = document.getElementById('exclusionsModal');
        this.defaultCover = '/images/default-cover.jpg';
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
            this.displayBooks(books);
        } catch (error) {
            console.error('Error:', error);
            this.bookGrid.innerHTML = '<div class="error">Error loading books</div>';
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
        
        bookElement.innerHTML = `
            <img src="${book.cover_image || this.defaultCover}" 
                 alt="${book.title}" 
                 class="book-cover"
                 onerror="this.src='${this.defaultCover}'">
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
        
         highlightsContainer.innerHTML = book.highlights
        .map(highlight => `
            <div class="highlight-item" data-highlight-id="${highlight.id}">
                <div class="highlight-content">
                    <blockquote>${highlight.text}</blockquote>
                    <small class="highlight-metadata">${highlight.metadata}</small>
                </div>
                <span class="exclude-highlight-icon" 
                      onclick="event.stopPropagation(); window.bookLibrary.excludeHighlight('${book.title}', '${highlight.id}', '${highlight.text}')">
                    ×
                </span>
            </div>
        `)
        .join('');
        
    this.highlightsModal.style.display = 'block';
    }

    async excludeHighlight(bookTitle, highlightId, highlightText) {
        try {
            await fetch('/api/exclude-highlight', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    bookTitle,
                    highlightText
                })
            });

            // Remove highlight from UI
            const highlightElement = document.querySelector(`[data-highlight-id="${highlightId}"]`);
            if (highlightElement) {
                highlightElement.style.opacity = '0'; // Fade out
                setTimeout(() => {
                    highlightElement.remove();
                    // Update highlight count in the modal
                    const countElement = document.getElementById('modal-highlight-count');
                    const currentCount = parseInt(countElement.textContent);
                    countElement.textContent = `${currentCount - 1} highlight${currentCount - 2 === 0 ? '' : 's'}`;
                }, 300);
            }

            // Refresh book list to update highlight counts
            this.init();
        } catch (error) {
            console.error('Error excluding highlight:', error);
        }
    }

    // Add method to view excluded highlights
    async showExcludedHighlights() {
        try {
            const response = await fetch('/api/excluded-highlights');
            const highlights = await response.json();
            
            const container = document.getElementById('excludedHighlightsList');
            container.innerHTML = highlights.map(h => `
                <div class="excluded-highlight">
                    <h4>${h.book_title}</h4>
                    <blockquote>${h.highlight_text}</blockquote>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error loading excluded highlights:', error);
        }
    }

    async loadExcludedBooks() {
        try {
            const response = await fetch('/api/excluded-books');
            const books = await response.json();
            
            const list = document.getElementById('excludedBooksList');
            list.innerHTML = books.map(book => `
                <div class="excluded-book">
                    <h4>${book.title}</h4>
                    <p>Author: ${book.author}</p>
                    <p>Reason: ${book.reason}</p>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error loading excluded books:', error);
        }
    }

    async addBookToExcludeList() {
        const title = document.getElementById('excludeTitle').value;
        const author = document.getElementById('excludeAuthor').value;
        const reason = document.getElementById('excludeReason').value;

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
                body: JSON.stringify({ title, author, reason })
            });

            // Refresh lists
            this.loadExcludedBooks();
            this.init(); // Reload main book list

            // Clear inputs
            document.getElementById('excludeTitle').value = '';
            document.getElementById('excludeAuthor').value = '';
            document.getElementById('excludeReason').value = '';
        } catch (error) {
            console.error('Error adding book to exclude list:', error);
        }
    }
}

// Make instance available globally for button click handlers
window.bookLibrary = new BookLibrary();

// Initialize when the page loads
window.addEventListener('load', () => {
    new BookLibrary();
});