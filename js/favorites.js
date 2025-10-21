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
    const id = await chatDB.addFavorite(conversationId);
    this.favorites.set(conversationId, {
      id,
      conversationId,
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
    return favArray.sort((a, b) => b.timestamp - a.timestamp);
  }

  // 获取收藏数量
  getCount() {
    return this.favorites.size;
  }
}

const favoritesManager = new FavoritesManager();

export { favoritesManager };
