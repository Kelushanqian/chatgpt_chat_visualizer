// 收藏功能管理
import chatDB from "./db.js";

class FavoritesManager {
  constructor() {
    this.favorites = new Map(); // conversationId -> favorite对象
  }

  // 初始化收藏数据
  async init() {
    const favorites = await chatDB.getFavorites();
    this.favorites.clear();
    for (const fav of favorites) {
      // 从数据库获取对话信息以补充title
      const conv = await chatDB.getConversation(fav.conversationId);
      fav.title = conv?.title || "未命名对话";
      this.favorites.set(fav.conversationId, fav);
    }
  }

  // 切换收藏状态
  async toggleFavorite(conversationId, conversation) {
    if (this.isFavorite(conversationId)) {
      await this.removeFavorite(conversationId);
      return false;
    } else {
      await this.addFavorite(conversationId, conversation);
      return true;
    }
  }

  // 添加收藏
  async addFavorite(conversationId, conversation) {
    const note = "";
    const id = await chatDB.addFavorite(conversationId, note);
    this.favorites.set(conversationId, {
      id,
      conversationId,
      note,
      timestamp: Date.now(),
      title: conversation?.title || "未命名对话",
    });
  }

  // 移除收藏
  async removeFavorite(conversationId) {
    await chatDB.removeFavorite(conversationId);
    this.favorites.delete(conversationId);
  }

  // 检查是否已收藏
  isFavorite(conversationId) {
    return this.favorites.has(conversationId);
  }

  // 获取所有收藏
  async getAllFavorites() {
    const favArray = Array.from(this.favorites.values());
    // 按时间倒序排列
    return favArray.sort((a, b) => b.timestamp - a.timestamp);
  }

  // 更新收藏备注
  async updateNote(conversationId, note) {
    if (!this.isFavorite(conversationId)) return;

    await chatDB.removeFavorite(conversationId);
    await chatDB.addFavorite(conversationId, note);

    const fav = this.favorites.get(conversationId);
    if (fav) {
      fav.note = note;
    }
  }

  // 获取收藏数量
  getCount() {
    return this.favorites.size;
  }
}

// 高亮/划线管理
class HighlightsManager {
  constructor() {
    this.highlights = new Map(); // conversationId -> highlights数组
  }

  // 初始化高亮数据
  async init() {
    const highlights = await chatDB.getAllHighlights();
    this.highlights.clear();

    highlights.forEach((hl) => {
      if (!this.highlights.has(hl.conversationId)) {
        this.highlights.set(hl.conversationId, []);
      }
      this.highlights.get(hl.conversationId).push(hl);
    });
  }

  // 添加高亮
  async addHighlight(conversationId, messageId, text, color = "yellow") {
    const id = await chatDB.addHighlight(
      conversationId,
      messageId,
      text,
      color
    );

    if (!this.highlights.has(conversationId)) {
      this.highlights.set(conversationId, []);
    }

    this.highlights.get(conversationId).push({
      id,
      conversationId,
      messageId,
      text,
      color,
      timestamp: Date.now(),
    });

    return id;
  }

  // 移除高亮
  async removeHighlight(highlightId, conversationId) {
    await chatDB.removeHighlight(highlightId);

    if (this.highlights.has(conversationId)) {
      const highlights = this.highlights.get(conversationId);
      const index = highlights.findIndex((hl) => hl.id === highlightId);
      if (index > -1) {
        highlights.splice(index, 1);
      }
    }
  }

  // 获取对话的所有高亮
  getHighlightsByConversation(conversationId) {
    return this.highlights.get(conversationId) || [];
  }

  // 获取所有高亮
  getAllHighlights() {
    const allHighlights = [];
    this.highlights.forEach((highlights) => {
      allHighlights.push(...highlights);
    });
    return allHighlights.sort((a, b) => b.timestamp - a.timestamp);
  }

  // 获取高亮数量
  getCount() {
    let count = 0;
    this.highlights.forEach((highlights) => {
      count += highlights.length;
    });
    return count;
  }
}

// 导出单例
const favoritesManager = new FavoritesManager();
const highlightsManager = new HighlightsManager();

export { favoritesManager, highlightsManager };
