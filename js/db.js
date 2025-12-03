// IndexedDB 数据库管理
const DB_NAME = "ChatGPTViewerDB";
const DB_VERSION = 1;

class ChatDatabase {
  constructor() {
    this.db = null;
  }

  // 初始化数据库
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 对话表
        if (!db.objectStoreNames.contains("conversations")) {
          const conversationStore = db.createObjectStore("conversations", {
            keyPath: "id",
          });
          conversationStore.createIndex("create_time", "create_time", {
            unique: false,
          });
          conversationStore.createIndex("title", "title", { unique: false });
        }

        // 收藏表
        if (!db.objectStoreNames.contains("favorites")) {
          const favStore = db.createObjectStore("favorites", {
            keyPath: "id",
            autoIncrement: true,
          });
          favStore.createIndex("conversationId", "conversationId", {
            unique: false,
          });
          favStore.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
    });
  }

  // 保存所有对话数据
  async saveConversations(conversations) {
    const tx = this.db.transaction(["conversations"], "readwrite");
    const store = tx.objectStore("conversations");

    const promises = conversations.map((conv) => {
      return new Promise((resolve, reject) => {
        const request = store.put(conv);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    await Promise.all(promises);
    return tx.complete;
  }

  // 获取所有对话
  async getAllConversations() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["conversations"], "readonly");
      const store = tx.objectStore("conversations");
      const request = store.getAll();

      request.onsuccess = () => {
          resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 获取单个对话的完整信息
  async getConversation(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["conversations"], "readonly");
      const store = tx.objectStore("conversations");
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // 收藏
  async addFavorite(conversationId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["favorites"], "readwrite");
      const store = tx.objectStore("favorites");

      const favorite = {
        conversationId,
        timestamp: Date.now(),
      };

      const request = store.add(favorite);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async removeFavorite(conversationId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["favorites"], "readwrite");
      const store = tx.objectStore("favorites");
      const index = store.index("conversationId");

      const request = index.openCursor(IDBKeyRange.only(conversationId));

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getFavorites() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["favorites"], "readonly");
      const store = tx.objectStore("favorites");
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async isFavorite(conversationId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["favorites"], "readonly");
      const store = tx.objectStore("favorites");
      const index = store.index("conversationId");
      const request = index.get(conversationId);

      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // 清空所有数据
  async clearAll() {
    const stores = ["conversations", "favorites"];
    const promises = stores.map((storeName) => {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction([storeName], "readwrite");
        const store = tx.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    return Promise.all(promises);
  }

  // 获取数据库统计信息
  async getStats() {
    const conversations = await this.getAllConversations();
    const favorites = await this.getFavorites();
    return {
      conversationsCount: conversations.length,
      favoritesCount: favorites.length,
    };
  }
}

// 导出单例
const chatDB = new ChatDatabase();
export default chatDB;