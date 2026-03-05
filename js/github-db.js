// ============================================================
//   GitHubDB v2 — ৩০০০ ব্যবহারকারীর জন্য অপটিমাইজড
//   ★ প্রতি ইউজারের ফলাফল আলাদা ফাইলে (No SHA Conflict)
//   ★ Cache System (API কল কমানোর জন্য)
//   ★ Raw URL দিয়ে পড়া (Rate Limit বাঁচায়)
// ============================================================

class GitHubDB {
    constructor() {
        this.token = CONFIG.GITHUB_TOKEN;
        this.owner = CONFIG.OWNER;
        this.repo = CONFIG.REPO;
        this.branch = CONFIG.BRANCH || 'main';
        this.apiBase = `https://api.github.com/repos/${this.owner}/${this.repo}`;
        this.rawBase = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}`;
        
        // Cache System
        this.cache = new Map();
        this.shaCache = new Map();
        this.CACHE_DURATION = 5 * 60 * 1000; // 5 মিনিট
    }

    // ─── UTILITY ─────────────────────────────────
    
    _encode(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }

    _decode(str) {
        return decodeURIComponent(escape(atob(str)));
    }

    _headers() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
    }

    _generateId() {
        return 'id_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    // ─── CACHE MANAGEMENT ────────────────────────

    _getCached(key) {
        const item = this.cache.get(key);
        if (item && (Date.now() - item.time < this.CACHE_DURATION)) {
            return item.data;
        }
        this.cache.delete(key);
        return null;
    }

    _setCache(key, data) {
        this.cache.set(key, { data, time: Date.now() });
    }

    _clearCache(key) {
        if (key) {
            this.cache.delete(key);
        } else {
            this.cache.clear();
        }
    }

    // ─── READ OPERATIONS ─────────────────────────

    // Raw URL দিয়ে পড়া (Public Repo - Rate Limit নেই)
    async readRaw(path) {
        const cached = this._getCached(`raw:${path}`);
        if (cached) return cached;

        const response = await fetch(`${this.rawBase}/${path}?t=${Date.now()}`);
        
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`Read failed: ${response.status}`);
        
        const data = await response.json();
        this._setCache(`raw:${path}`, data);
        return data;
    }

    // API দিয়ে পড়া (SHA সহ - Write এর জন্য দরকার)
    async readAPI(path) {
        const cached = this._getCached(`api:${path}`);
        if (cached) return cached;

        const response = await fetch(`${this.apiBase}/contents/${path}`, {
            headers: this._headers()
        });

        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`API read failed: ${response.status}`);

        const fileData = await response.json();
        this.shaCache.set(path, fileData.sha);
        
        const content = JSON.parse(this._decode(fileData.content));
        this._setCache(`api:${path}`, content);
        return content;
    }

    // ─── WRITE OPERATIONS ────────────────────────

    // ফাইল তৈরি বা আপডেট
    async writeFile(path, data, message = '') {
        const commitMsg = message || `Update ${path}`;
        
        const body = {
            message: commitMsg,
            content: this._encode(JSON.stringify(data, null, 2)),
            branch: this.branch
        };

        // SHA থাকলে যোগ করো (আপডেটের জন্য)
        const sha = this.shaCache.get(path);
        if (sha) {
            body.sha = sha;
        } else {
            // SHA না থাকলে চেক করো ফাইল আছে কিনা
            try {
                const existing = await fetch(`${this.apiBase}/contents/${path}`, {
                    headers: this._headers()
                });
                if (existing.ok) {
                    const fileData = await existing.json();
                    body.sha = fileData.sha;
                }
            } catch (e) { /* নতুন ফাইল */ }
        }

        const response = await fetch(`${this.apiBase}/contents/${path}`, {
            method: 'PUT',
            headers: this._headers(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || 'Write failed');
        }

        const result = await response.json();
        this.shaCache.set(path, result.content.sha);
        this._clearCache(`raw:${path}`);
        this._clearCache(`api:${path}`);
        
        return result;
    }

    // নতুন ফাইল তৈরি (SHA ছাড়া - দ্রুত)
    async createFile(path, data, message = '') {
        const body = {
            message: message || `Create ${path}`,
            content: this._encode(JSON.stringify(data, null, 2)),
            branch: this.branch
        };

        const response = await fetch(`${this.apiBase}/contents/${path}`, {
            method: 'PUT',
            headers: this._headers(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || 'Create failed');
        }

        return await response.json();
    }

    // ─── COLLECTION OPERATIONS ───────────────────

    // JSON ফাইল থেকে ডাটা পড়া
    async getCollection(name) {
        return await this.readAPI(`data/${name}.json`);
    }

    // JSON ফাইল সংরক্ষণ
    async saveCollection(name, data, msg) {
        return await this.writeFile(`data/${name}.json`, data, msg);
    }

    // Collection এর সব আইটেম
    async getAll(collectionName) {
        const data = await this.getCollection(collectionName);
        if (!data) return [];
        const key = Object.keys(data)[0];
        return data[key] || [];
    }

    // শর্ত দিয়ে খোঁজা
    async findOne(collectionName, field, value) {
        const items = await this.getAll(collectionName);
        return items.find(item => item[field] === value) || null;
    }

    // নতুন আইটেম যোগ
    async addToCollection(collectionName, newItem) {
        const data = await this.getCollection(collectionName);
        const key = Object.keys(data)[0];
        newItem.id = newItem.id || this._generateId();
        newItem.createdAt = new Date().toISOString();
        data[key].push(newItem);
        await this.saveCollection(collectionName, data);
        return newItem;
    }

    // আইটেম আপডেট
    async updateInCollection(collectionName, id, updates) {
        const data = await this.getCollection(collectionName);
        const key = Object.keys(data)[0];
        const idx = data[key].findIndex(item => item.id === id);
        if (idx === -1) throw new Error('Item not found');
        data[key][idx] = { ...data[key][idx], ...updates };
        await this.saveCollection(collectionName, data);
        return data[key][idx];
    }

    // আইটেম মুছা
    async deleteFromCollection(collectionName, id) {
        const data = await this.getCollection(collectionName);
        const key = Object.keys(data)[0];
        data[key] = data[key].filter(item => item.id !== id);
        await this.saveCollection(collectionName, data);
    }

    // ─── RESULT OPERATIONS (Individual Files) ────

    // কুইজ ফলাফল সংরক্ষণ (আলাদা ফাইলে)
    async saveResult(quizId, userId, resultData) {
        const path = `results/${quizId}/${userId}.json`;
        return await this.createFile(path, resultData, 
            `Quiz result: ${quizId} by ${userId}`);
    }

    // একজনের ফলাফল পড়া
    async getResult(quizId, userId) {
        const path = `results/${quizId}/${userId}.json`;
        try {
            return await this.readRaw(path);
        } catch (e) {
            return null;
        }
    }

    // ফলাফল আছে কিনা চেক (দ্রুত - HEAD request)
    async hasResult(quizId, userId) {
        const path = `results/${quizId}/${userId}.json`;
        try {
            const response = await fetch(`${this.apiBase}/contents/${path}`, {
                method: 'HEAD',
                headers: this._headers()
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    // সব ফলাফল পড়া (Admin - Tree API ব্যবহার)
    async getAllResults(quizId) {
        try {
            // Git Tree API - একবারেই সব ফাইল পাওয়া যায়
            const response = await fetch(
                `${this.apiBase}/git/trees/${this.branch}?recursive=1`,
                { headers: this._headers() }
            );
            
            if (!response.ok) throw new Error('Tree fetch failed');
            
            const tree = await response.json();
            const resultFiles = tree.tree.filter(f => 
                f.path.startsWith(`results/${quizId}/`) && 
                f.path.endsWith('.json') &&
                f.type === 'blob'
            );

            // প্রতিটি ফাইলের content পড়া (parallel)
            const results = await Promise.all(
                resultFiles.map(async (file) => {
                    try {
                        const res = await fetch(`${this.rawBase}/${file.path}?t=${Date.now()}`);
                        if (res.ok) return await res.json();
                        return null;
                    } catch (e) {
                        return null;
                    }
                })
            );

            return results.filter(r => r !== null);
        } catch (error) {
            console.error('Error fetching results:', error);
            return [];
        }
    }

    // ফলাফল গণনা (Tree API - ফাইল count)
    async countResults(quizId) {
        try {
            const response = await fetch(
                `${this.apiBase}/git/trees/${this.branch}?recursive=1`,
                { headers: this._headers() }
            );
            const tree = await response.json();
            return tree.tree.filter(f => 
                f.path.startsWith(`results/${quizId}/`) && 
                f.path.endsWith('.json')
            ).length;
        } catch (e) {
            return 0;
        }
    }
}

// Global Instance
const db = new GitHubDB();
