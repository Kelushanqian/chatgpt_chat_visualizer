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

        // 高亮/划线表
        if (!db.objectStoreNames.contains("highlights")) {
          const highlightStore = db.createObjectStore("highlights", {
            keyPath: "id",
            autoIncrement: true,
          });
          highlightStore.createIndex("conversationId", "conversationId", {
            unique: false,
          });
          highlightStore.createIndex("messageId", "messageId", {
            unique: false,
          });
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

  // 获取所有对话（可选择是否加载消息）
  async getAllConversations(includeMessages = false) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["conversations"], "readonly");
      const store = tx.objectStore("conversations");
      const request = store.getAll();

      request.onsuccess = () => {
        if (includeMessages) {
          // 返回完整数据
          resolve(request.result);
        } else {
          // 返回不含完整消息的轻量数据
          const conversations = request.result.map((conv) => ({
            ...conv,
            messages: [], // 暂不加载消息
          }));
          resolve(conversations);
        }
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

  // 搜索对话
  async searchConversations(searchTerm) {
    const allConversations = await this.getAllConversations();
    return allConversations.filter((conv) =>
      (conv.title || "").toLowerCase().includes(searchTerm.toLowerCase())
    );
  }

  // 收藏相关操作
  async addFavorite(conversationId, note = "") {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["favorites"], "readwrite");
      const store = tx.objectStore("favorites");

      const favorite = {
        conversationId,
        note,
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

  // 高亮/划线相关操作
  async addHighlight(conversationId, messageId, text, color = "yellow", note = "") {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["highlights"], "readwrite");
      const store = tx.objectStore("highlights");

      const highlight = {
        conversationId,
        messageId,
        text,
        color,
        note,
        timestamp: Date.now(),
      };

      const request = store.add(highlight);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async removeHighlight(highlightId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["highlights"], "readwrite");
      const store = tx.objectStore("highlights");
      const request = store.delete(highlightId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getHighlightsByConversation(conversationId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["highlights"], "readonly");
      const store = tx.objectStore("highlights");
      const index = store.index("conversationId");
      const request = index.getAll(conversationId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllHighlights() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["highlights"], "readonly");
      const store = tx.objectStore("highlights");
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // 清空所有数据
  async clearAll() {
    const stores = ["conversations", "favorites", "highlights"];
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
    const highlights = await this.getAllHighlights();

    return {
      conversationsCount: conversations.length,
      favoritesCount: favorites.length,
      highlightsCount: highlights.length,
    };
  }
}

// 导出单例
const chatDB = new ChatDatabase();
export default chatDB;