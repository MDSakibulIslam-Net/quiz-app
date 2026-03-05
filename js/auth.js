// ==========================================
//   Authentication System
//   Login, Logout, Registration
// ==========================================

class Auth {
    constructor() {
        this.sessionKey = 'quiz_session';
    }

    async login(username, password) {
        try {
            const user = await db.findOne('users', 'username', username);
            
            if (!user) return { success: false, message: 'User not found!' };
            if (user.password !== password) return { success: false, message: 'Wrong password!' };
            if (user.status !== 'active') return { success: false, message: 'Account is inactive!' };
            
            const session = { ...user };
            delete session.password;
            session.loginTime = new Date().toISOString();
            
            localStorage.setItem(this.sessionKey, JSON.stringify(session));
            return { success: true, user: session };
        } catch (error) {
            return { success: false, message: 'Server error: ' + error.message };
        }
    }

    logout() {
        localStorage.removeItem(this.sessionKey);
        window.location.href = 'index.html';
    }

    getUser() {
        const data = localStorage.getItem(this.sessionKey);
        return data ? JSON.parse(data) : null;
    }

    isLoggedIn() { 
        return !!this.getUser(); 
    }
    
    isAdmin() { 
        const u = this.getUser(); 
        return u && u.role === 'admin'; 
    }

    requireAuth(role = null) {
        if (!this.isLoggedIn()) { 
            window.location.href = 'index.html'; 
            return false; 
        }
        if (role && this.getUser().role !== role) { 
            alert('Access denied!'); 
            window.location.href = 'index.html'; 
            return false; 
        }
        return true;
    }

    async register(data) {
        const exists = await db.findOne('users', 'username', data.username);
        if (exists) return { success: false, message: 'Username already taken!' };
        
        const phoneExists = await db.findOne('users', 'phone', data.phone);
        if (phoneExists) return { success: false, message: 'Phone already used!' };
        
        data.id = 'user_' + Date.now().toString(36);
        data.role = 'user';
        data.status = 'active';
        
        await db.addToCollection('users', data);
        return { success: true };
    }
}

// Global Instance
const auth = new Auth();
