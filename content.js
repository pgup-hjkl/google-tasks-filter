/**
 * Google Tasks Filter - Strict Version
 * Logic: Strict text matching.
 * Fix: The first task is now treated exactly like the rest. If it doesn't have the tag, it hides.
 */

console.log("Tasks Filter: Strict v13.0");

// --- UTILS ---
const Storage = {
    get: (key, cb) => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.get([key], r => cb(r[key] || []));
        } else {
            const v = localStorage.getItem('tf_' + key);
            cb(v ? JSON.parse(v) : []);
        }
    },
    set: (key, val, cb) => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            const o = {}; o[key] = val;
            chrome.storage.local.set(o, cb);
        } else {
            localStorage.setItem('tf_' + key, JSON.stringify(val));
            if (cb) cb();
        }
    }
};

class GoogleTasksFilter {
    constructor() {
        this.state = {
            tags: [],
            activeFilters: new Set(),
            filterMode: 'OR',
            isDeleteMode: false
        };
        this.dom = { container: null, observer: null, debounce: null };
        this.handleMutation = this.handleMutation.bind(this);
        this.init = this.init.bind(this);
    }

    // --- INITIALIZATION ---
    init() {
        // Find the container
        const taskItem = document.querySelector('div[role="listitem"]');
        let container = taskItem ? taskItem.parentElement : document.querySelector('div[role="main"]');

        if (!container) {
            setTimeout(this.init, 500);
            return;
        }

        this.dom.container = container;
        
        Storage.get('customTags', (tags) => {
            this.state.tags = tags;
            this.render();
            this.startObserver();
        });
    }

    startObserver() {
        if (this.dom.observer) this.dom.observer.disconnect();
        this.dom.observer = new MutationObserver(this.handleMutation);
        this.dom.observer.observe(document.body, { childList: true, subtree: true });
    }

    handleMutation(mutations) {
        let shouldRefilter = false;
        
        if (!document.getElementById('tag-filter-bar')) {
            this.init();
            return;
        }

        for (const m of mutations) {
            if (m.type === 'childList') shouldRefilter = true;
        }

        if (shouldRefilter) {
            clearTimeout(this.dom.debounce);
            this.dom.debounce = setTimeout(() => this.applyFilter(), 100);
        }
    }

    // --- RENDERING ---
    render() {
        if (!this.dom.container) return;

        let bar = document.getElementById('tag-filter-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'tag-filter-bar';
            this.dom.container.prepend(bar);
        }
        bar.innerHTML = '';

        // Mode Button
        const modeBtn = this.createChip(this.state.filterMode === 'OR' ? 'Any' : 'All', ['mode-btn']);
        if (this.state.filterMode === 'AND') modeBtn.classList.add('mode-active');
        
        modeBtn.onclick = (e) => {
            e.stopPropagation();
            if (this.state.isDeleteMode) return;
            this.state.filterMode = this.state.filterMode === 'OR' ? 'AND' : 'OR';
            this.render();
            this.applyFilter();
        };
        bar.appendChild(modeBtn);

        // Tags
        this.state.tags.sort().forEach(tag => {
            const clean = tag.toLowerCase();
            const active = this.state.activeFilters.has(clean);
            const btn = this.createChip(`#${tag}`, active ? ['active'] : []);
            
            if (this.state.isDeleteMode) btn.classList.add('delete-mode-active');

            btn.onclick = (e) => {
                e.stopPropagation();
                if (this.state.isDeleteMode) {
                    this.deleteTag(tag);
                } else {
                    if (active) this.state.activeFilters.delete(clean);
                    else this.state.activeFilters.add(clean);
                    this.render();
                    this.applyFilter();
                }
            };
            bar.appendChild(btn);
        });

        this.renderControls(bar);
    }

    renderControls(bar) {
        const div = document.createElement('div');
        div.className = 'input-container';

        const input = document.createElement('input');
        input.className = 'tag-input';
        input.placeholder = 'Tag...';
        input.type = 'text';
        if (this.state.isDeleteMode) input.disabled = true;
        
        const commit = () => { if(input.value.trim()) this.addTag(input.value); };
        input.onkeydown = (e) => { if(e.key === 'Enter') commit(); };

        const addBtn = document.createElement('button');
        addBtn.className = 'control-btn add-btn';
        addBtn.innerText = '+';
        addBtn.onclick = commit;

        const trashBtn = document.createElement('button');
        trashBtn.className = `control-btn trash-btn ${this.state.isDeleteMode ? 'trash-active' : ''}`;
        trashBtn.innerText = '🗑️';
        trashBtn.onclick = () => {
            this.state.isDeleteMode = !this.state.isDeleteMode;
            this.render();
        };

        div.append(input, addBtn, trashBtn);
        bar.appendChild(div);
    }

    createChip(text, classes = []) {
        const d = document.createElement('div');
        d.className = `filter-chip ${classes.join(' ')}`;
        d.innerText = text;
        return d;
    }

    addTag(val) {
        const clean = val.replace('#', '').toLowerCase();
        if (!this.state.tags.includes(clean)) {
            this.state.tags.push(clean);
            Storage.set('customTags', this.state.tags, () => this.render());
        }
    }

    deleteTag(tag) {
        this.state.tags = this.state.tags.filter(t => t !== tag);
        this.state.activeFilters.delete(tag);
        Storage.set('customTags', this.state.tags, () => {
            this.render();
            this.applyFilter();
        });
    }

    // --- CORE LOGIC ---

    applyFilter() {
        const tasks = document.querySelectorAll('div[role="listitem"]');

        tasks.forEach(task => {
            const text = task.innerText.toLowerCase();
            
            // --- 1. ONLY PROTECT THE "ADD TASK" BUTTON ---
            // We use exact text checking to ensure we don't accidentally protect a real task.
            // If it says "Add a task" or "Create new", we assume it's the button.
            if (text.includes('add a task') || text.includes('create new')) {
                task.classList.remove('task-hidden');
                return;
            }

            // --- 2. FILTER EVERYTHING ELSE (No exceptions for first task/editing) ---
            
            if (this.state.activeFilters.size === 0) {
                task.classList.remove('task-hidden');
                return;
            }

            let shouldShow = false;

            if (this.state.filterMode === 'OR') {
                let matchCount = 0;
                this.state.activeFilters.forEach(tag => {
                    if (text.includes('#' + tag)) matchCount++;
                });
                shouldShow = (matchCount > 0);
            } 
            else { // AND
                let allMatch = true;
                this.state.activeFilters.forEach(tag => {
                    if (!text.includes('#' + tag)) allMatch = false;
                });
                shouldShow = allMatch;
            }

            if (shouldShow) task.classList.remove('task-hidden');
            else task.classList.add('task-hidden');
        });
    }
}

const app = new GoogleTasksFilter();
setTimeout(app.init, 500);
setTimeout(app.init, 1500);