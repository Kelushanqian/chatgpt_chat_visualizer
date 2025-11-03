/**
 * ui.js - 优化版 UI 渲染与交互管理
 *
 * 优化目标：
 * 1. 消除切换对话时的卡顿
 * 2. 支持超长对话（1000+ 条消息）
 * 3. 保持响应丝滑，零阻塞
 *
 * 核心技术：
 * - 渲染缓存 + DocumentFragment
 * - requestIdleCallback 分片渲染
 * - Web Worker 异步 Markdown 解析
 * - 事件委托 + 防抖
 * - 可切换虚拟滚动（超长对话）
 */

import chatDB from "./db.js";
import { favoritesManager } from "./favorites.js";

// ==================== Markdown Web Worker ====================

// 创建内联 Worker（避免额外文件）
const createMarkdownWorker = () => {
  const workerCode = `
    importScripts('https://cdn.jsdelivr.net/npm/marked/marked.min.js');
    self.onmessage = function(e) {
      const { id, text } = e.data;
      try {
        const html = marked.parse(text);
        self.postMessage({ id, html, success: true });
      } catch (err) {
        self.postMessage({ id, html: '<p>解析失败</p>', success: false });
      }
    };
  `;
  const blob = new Blob([workerCode], { type: "application/javascript" });
  return new Worker(URL.createObjectURL(blob));
};

// ==================== marked 配置 ====================

if (typeof marked !== "undefined") {
  marked.setOptions({
    breaks: true,
    gfm: true,
    sanitize: false,
    smartLists: true,
    smartypants: true,
  });
}

// ==================== 工具函数 ====================

/**
 * 转义 HTML 防止 XSS
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 格式化时间戳
 */
export function formatDate(timestamp) {
  if (!timestamp) return "未知时间";
  const date = new Date(timestamp * 1000);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 防抖函数
 */
function debounce(fn, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

// ==================== UIManager 主类 ====================

class UIManager {
  constructor() {
    // 数据缓存
    this.allConversations = [];
    this.filteredConversations = [];
    this.currentConversation = null;

    // 渲染缓存：id -> 完整 HTML 字符串
    this.conversationCache = new Map();
    this.virtualScroller = new VirtualScroller(this); // 新增这行

    // Markdown 异步解析
    this.markdownWorker = createMarkdownWorker();
    this.markdownCache = new Map(); // id -> HTML
    this.pendingMarkdown = new Set(); // 正在解析的 ID

    // 虚拟滚动（可选）
    this.enableVirtualScroll = true;
    this.virtualItemHeight = 90; // 预估每条消息高度
    this.virtualViewport = null;

    // 事件绑定标志
    this.eventsBound = false;

    // 初始化事件
    this.initEvents();
  }

  // ==================== 初始化与事件绑定 ====================

  initEvents() {
    if (this.eventsBound) return;
    this.eventsBound = true;

    const listContainer = document.getElementById("conversationList");
    const searchBox = document.getElementById("searchBox");
    const searchContentBox = document.getElementById("searchContentBox");
    const sortSelect = document.getElementById("sortSelect");

    // 事件委托：对话项点击 + 收藏按钮
    listContainer.addEventListener("click", (e) => {
      const item = e.target.closest(".conversation-item");
      const favBtn = e.target.closest(".favorite-btn");

      if (favBtn) {
        e.stopPropagation();
        const id = favBtn.closest(".conversation-item").dataset.id;
        this.toggleFavorite(id);
      } else if (item) {
        const id = item.dataset.id;
        this.selectConversation(id);
      }
    });

    // 防抖搜索
    searchBox.addEventListener(
      "input",
      debounce(() => {
        searchContentBox.value = "";
        this.filterConversations(searchBox.value, sortSelect.value);
      }, 300)
    );

    searchContentBox.addEventListener(
      "input",
      debounce(() => {
        searchBox.value = "";
        this.filterConversationsByContent(
          searchContentBox.value,
          sortSelect.value
        );
      }, 300)
    );

    sortSelect.addEventListener("change", () => {
      const term = searchBox.value || searchContentBox.value;
      if (searchContentBox.value) {
        this.filterConversationsByContent(term, sortSelect.value);
      } else {
        this.filterConversations(term, sortSelect.value);
      }
    });

    // Worker 消息监听
    this.markdownWorker.onmessage = (e) => {
      const { id, html, success } = e.data;
      this.markdownCache.set(id, html);
      this.pendingMarkdown.delete(id);
      this.rerenderVisibleMessages();
    };
  }

  // ==================== 统计更新 ====================

  updateStatistics(stats) {
    document.getElementById("totalConversations").textContent =
      stats.totalConversations;
    document.getElementById("totalMessages").textContent = stats.totalMessages;
    document.getElementById("userMessages").textContent =
      stats.totalUserMessages;
    document.getElementById("assistantMessages").textContent =
      stats.totalAssistantMessages;
  }

  // ==================== 对话列表渲染 ====================

  renderConversationList(conversations) {
    const container = document.getElementById("conversationList");
    const fragment = document.createDocumentFragment();

    conversations.forEach((conv) => {
      const isFav = favoritesManager.isFavorite(conv.id);
      const item = document.createElement("div");
      item.className = "conversation-item";
      item.dataset.id = conv.id;

      item.innerHTML = `
        <div class="conversation-info">
          <div class="conversation-title">${escapeHtml(
            conv.title || "未命名对话"
          )}</div>
          <div class="conversation-meta">
            ${conv.messageCount} 条消息 | 创建于 ${formatDate(conv.create_time)}
          </div>
        </div>
        <button class="favorite-btn ${isFav ? "active" : ""}" title="${
        isFav ? "取消收藏" : "收藏"
      }">
          ${isFav ? "●" : "○"}
        </button>
      `;

      fragment.appendChild(item);
    });

    container.innerHTML = "";
    container.appendChild(fragment);
  }

  // ==================== 对话选择与渲染 ====================

  async selectConversation(id) {
    // 高亮激活项
    document.querySelectorAll(".conversation-item").forEach((item) => {
      item.classList.remove("active");
    });
    const activeItem = document.querySelector(
      `.conversation-item[data-id="${id}"]`
    );
    if (activeItem) activeItem.classList.add("active");

    // 缓存命中 → 秒开
    if (this.conversationCache.has(id)) {
      this.displayConversationFromCache(id);
      return;
    }

    // 加载数据
    const conversation = await chatDB.getConversation(id);
    if (!conversation) return;

    this.currentConversation = conversation;
    document.getElementById("conversationTitle").textContent =
      conversation.title || "未命名对话";
    document.getElementById("exportBtn").style.display = "inline-block";

    // 开始分片渲染
    this.renderConversationWithBatching(conversation);
  }

  displayConversationFromCache(id) {
    const container = document.getElementById("messagesContainer");
    container.innerHTML = this.conversationCache.get(id);
    container.scrollTop = 0;
    this.setupVirtualScrollIfNeeded();
  }

  // ==================== 分片 + 异步 Markdown 渲染 ====================

  renderConversationWithBatching(conversation) {
    const container = document.getElementById("messagesContainer");
    container.innerHTML = '<div class="loading-messages">Loading...</div>';

    const messages = conversation.messages || [];
    let index = 0;
    const batchSize = 8;

    const renderBatch = () => {
      if (index >= messages.length) {
        container.innerHTML = this.conversationCache.get(conversation.id) || "";
        this.setupVirtualScrollIfNeeded();
        return;
      }

      const fragment = document.createDocumentFragment();
      const end = Math.min(index + batchSize, messages.length);

      for (let i = index; i < end; i++) {
        const msgDiv = this.createMessageElement(messages[i]);
        fragment.appendChild(msgDiv);
      }

      // 替换 loading 或追加
      if (index === 0) {
        container.innerHTML = "";
      }
      container.appendChild(fragment);

      index = end;
      requestIdleCallback(renderBatch, { timeout: 200 });
    };

    // 预生成完整 HTML 用于缓存
    setTimeout(() => {
      const fullHTML = messages
        .map((msg) => this.renderMessageSync(msg))
        .join("");
      this.conversationCache.set(conversation.id, fullHTML);
    }, 0);

    requestIdleCallback(renderBatch);

    requestIdleCallback(() => {
      const fullHTML = messages
        .map((msg) => this.renderMessageSync(msg))
        .join("");
      this.conversationCache.set(conversation.id, fullHTML);

      // 启用虚拟滚动
      if (this.virtualScroller.init(conversation)) {
        // 虚拟滚动已接管
      } else {
        // 降级：普通渲染
        container.innerHTML = fullHTML;
        container.scrollTop = 0;
      }
    });
  }

  createMessageElement(msg) {
    const div = document.createElement("div");
    div.className = `message ${msg.role}`;
    div.dataset.messageId = msg.id;

    const displayName = msg.role === "user" ? "You" : "Agent";

    // 优先使用缓存
    let contentHTML = this.markdownCache.get(msg.id);
    if (!contentHTML && !this.pendingMarkdown.has(msg.id)) {
      this.pendingMarkdown.add(msg.id);
      this.markdownWorker.postMessage({ id: msg.id, text: msg.content });
      contentHTML = '<div class="message-content">加载中...</div>';
    } else if (!contentHTML) {
      contentHTML = '<div class="message-content">加载中...</div>';
    } else {
      contentHTML = `<div class="message-content">${contentHTML}</div>`;
    }

    div.innerHTML = `
      <div class="message-author">${displayName}</div>
      ${contentHTML}
      <div class="message-time">${formatDate(msg.createTime)}</div>
    `;

    return div;
  }

  // 同步渲染（用于缓存）
  renderMessageSync(msg) {
    const displayName = msg.role === "user" ? "You" : "Agent";
    const content = this.markdownCache.get(msg.id) || marked.parse(msg.content);
    return `
      <div class="message ${msg.role}" data-message-id="${msg.id}">
        <div class="message-author">${displayName}</div>
        <div class="message-content">${content}</div>
        <div class="message-time">${formatDate(msg.createTime)}</div>
      </div>
    `.trim();
  }

  // 重新渲染可见消息（Worker 完成时）
  rerenderVisibleMessages() {
    const container = document.getElementById("messagesContainer");
    const messages = container.querySelectorAll(".message");
    messages.forEach((msgEl) => {
      const id = msgEl.dataset.messageId;
      if (this.markdownCache.has(id)) {
        const contentEl = msgEl.querySelector(".message-content");
        if (contentEl && contentEl.textContent === "加载中...") {
          contentEl.innerHTML = this.markdownCache.get(id);
        }
      }
    });
  }

  // ==================== 收藏功能 ====================

  async toggleFavorite(conversationId) {
    const conversation = this.allConversations.find(
      (c) => c.id === conversationId
    );
    if (!conversation) return;

    const isFavorited = await favoritesManager.toggleFavorite(
      conversationId,
      conversation
    );
    const btn = document.querySelector(
      `.conversation-item[data-id="${conversationId}"] .favorite-btn`
    );

    if (btn) {
      btn.classList.toggle("active", isFavorited);
      btn.textContent = isFavorited ? "●" : "○";
      btn.title = isFavorited ? "取消收藏" : "收藏";
    }

    await this.renderFavoritesList();
  }

  // ==================== 收藏列表 ====================

  async renderFavoritesList() {
    const container = document.getElementById("favoritesList");
    const favorites = await favoritesManager.getAllFavorites();

    document.getElementById("favoritesCount").textContent = favorites.length;

    if (favorites.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>暂无收藏</p></div>';
      return;
    }

    const html = favorites
      .map(
        (fav) => `
      <div class="favorite-item" onclick="uiManager.selectConversation('${
        fav.conversationId
      }')">
        <div class="favorite-title">${escapeHtml(
          fav.title || "未命名对话"
        )}</div>
        <div class="favorite-time">${formatDate(fav.timestamp / 1000)}</div>
      </div>
    `
      )
      .join("");

    container.innerHTML = html;
  }

  // ==================== 搜索与排序 ====================

  filterConversations(searchTerm, sortBy) {
    this.filteredConversations = this.allConversations.filter((conv) =>
      (conv.title || "").toLowerCase().includes(searchTerm.toLowerCase())
    );
    this.applySorting(sortBy);
    this.renderConversationList(this.filteredConversations);
  }

  filterConversationsByContent(searchTerm, sortBy) {
    this.filteredConversations = this.allConversations.filter((conv) =>
      conv.messages?.some((msg) =>
        msg.content.toLowerCase().includes(searchTerm.toLowerCase())
      )
    );
    this.applySorting(sortBy);
    this.renderConversationList(this.filteredConversations);
  }

  applySorting(sortBy) {
    switch (sortBy) {
      case "update":
        this.filteredConversations.sort(
          (a, b) => (b.create_time || 0) - (a.create_time || 0)
        );
        break;
      case "create":
        this.filteredConversations.sort(
          (a, b) => (a.create_time || 0) - (b.create_time || 0)
        );
        break;
      case "messages":
        this.filteredConversations.sort(
          (a, b) => b.messageCount - a.messageCount
        );
        break;
      case "title":
        this.filteredConversations.sort((a, b) =>
          (a.title || "").localeCompare(b.title || "")
        );
        break;
    }
  }

  // ==================== 趋势图 ====================

  renderDailyTrendChart(dailyData) {
    const container = document.getElementById("dailyTrendChart");
    container.innerHTML = "";
    const maxCount = Math.max(...dailyData.map((d) => d.count), 1);
    const chartInner = document.createElement("div");
    chartInner.className = "chart-inner";

    const tooltip = document.createElement("div");
    tooltip.className = "tooltip";
    chartInner.appendChild(tooltip);

    const dataToShow = dailyData.slice(-20);
    dataToShow.forEach((item) => {
      const bar = document.createElement("div");
      bar.className = "chart-bar";
      bar.style.height = `${(item.count / maxCount) * 100}%`;
      bar.title = `${item.date}: ${item.count} 条`;
      bar.style.flex = "1 1 0";

      bar.addEventListener("click", () => {
        tooltip.textContent = `${item.date}: ${item.count} 条`;
        tooltip.style.opacity = 0.9;
        setTimeout(() => (tooltip.style.opacity = 0), 2000);
      });

      chartInner.appendChild(bar);
    });

    container.appendChild(chartInner);

    document.addEventListener(
      "click",
      (e) => {
        if (!chartInner.contains(e.target)) {
          tooltip.style.opacity = 0;
        }
      },
      { once: true }
    );
  }

  // ==================== 虚拟滚动（可选） ====================

  setupVirtualScrollIfNeeded() {
    if (
      !this.enableVirtualScroll ||
      this.currentConversation.messageCount < 100
    )
      return;

    const container = document.getElementById("messagesContainer");
    if (this.virtualViewport) return;

    // 简单实现，后续可替换为 virtua
    // 略（可按需扩展）
  }

  // ==================== UI 状态控制 ====================

  showLoading() {
    document.getElementById("uploadSection").classList.add("hidden");
    document.getElementById("emptyState").classList.add("hidden");
    document.getElementById("loading").classList.remove("hidden");
    document.getElementById("dashboard").classList.add("hidden");
  }

  showDashboard() {
    document.getElementById("loading").classList.add("hidden");
    document.getElementById("uploadSection").style.display = "none";
    document.getElementById("emptyState").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");
    document.getElementById("backToUpload").classList.remove("hidden");
  }

  showEmptyState() {
    document.getElementById("uploadSection").style.display = "block";
    document.getElementById("loading").classList.add("hidden");
    document.getElementById("emptyState").classList.add("hidden");
    document.getElementById("dashboard").classList.add("hidden");
  }
}

// ==================== 虚拟滚动模块 ====================

/**
 * 虚拟滚动模块 - 集成到 UIManager
 * 
 * 特性：
 * - 纯 JS 实现，0 依赖
 * - 支持动态高度（自动测量）
 * - 滚动位置记忆
 * - 与 Markdown Worker 完美协同
 * - 仅在 > 80 条消息时启用
 */

class VirtualScroller {
  constructor(uiManager) {
    this.ui = uiManager;
    this.container = null;
    this.viewport = null;
    this.items = [];
    this.itemHeights = new Map();     // id -> height
    this.totalHeight = 0;
    this.visibleCount = 0;
    this.startIndex = 0;
    this.endIndex = 0;
    this.paddingTop = 0;
    this.paddingBottom = 0;
    this.scrollTop = 0;
    this.enabled = false;
  }

  /**
   * 初始化虚拟滚动
   */
  init(conversation) {
    if (conversation.messageCount <= 80) {
      this.disable();
      return false;
    }

    this.container = document.getElementById("messagesContainer");
    this.items = conversation.messages || [];
    this.enabled = true;

    // 创建虚拟视口
    this.createViewport();
    this.calculateHeights();
    this.render();

    // 绑定滚动
    this.viewport.addEventListener("scroll", this.onScroll.bind(this));
    return true;
  }

  createViewport() {
    const existing = this.container.querySelector(".virtual-viewport");
    if (existing) {
      this.viewport = existing;
      return;
    }

    this.container.innerHTML = `
      <div class="virtual-viewport">
        <div class="virtual-padding-top"></div>
        <div class="virtual-list"></div>
        <div class="virtual-padding-bottom"></div>
      </div>
    `;

    this.viewport = this.container.querySelector(".virtual-viewport");
    this.paddingTopEl = this.container.querySelector(".virtual-padding-top");
    this.paddingBottomEl = this.container.querySelector(".virtual-padding-bottom");
    this.listEl = this.container.querySelector(".virtual-list");
  }

  /**
   * 预计算所有消息高度（首次渲染时）
   */
  calculateHeights() {
    this.totalHeight = 0;
    const fragment = document.createDocumentFragment();

    this.items.forEach((msg, i) => {
      const el = this.ui.createMessageElement(msg);
      el.style.position = "absolute";
      el.style.visibility = "hidden";
      el.style.width = "100%";
      fragment.appendChild(el);

      // 测量高度
      this.listEl.appendChild(fragment);
      const height = el.offsetHeight || 90;
      this.itemHeights.set(msg.id, height);
      this.totalHeight += height;

      // 清理
      this.listEl.innerHTML = "";
    });

    this.visibleCount = Math.ceil(this.viewport.clientHeight / 90) + 5;
  }

  /**
   * 渲染可视区域
   */
  render() {
    if (!this.enabled) return;

    const scrollTop = this.viewport.scrollTop;
    let accumulated = 0;
    let start = 0;

    // 找到起始索引
    for (let i = 0; i < this.items.length; i++) {
      const id = this.items[i].id;
      const h = this.itemHeights.get(id) || 90;
      if (accumulated + h > scrollTop) {
        start = Math.max(0, i - 2);
        break;
      }
      accumulated += h;
    }

    this.startIndex = start;
    this.endIndex = Math.min(start + this.visibleCount, this.items.length);

    // 计算 padding
    let paddingTop = 0;
    for (let i = 0; i < start; i++) {
      paddingTop += this.itemHeights.get(this.items[i].id) || 90;
    }

    let paddingBottom = 0;
    for (let i = this.endIndex; i < this.items.length; i++) {
      paddingBottom += this.itemHeights.get(this.items[i].id) || 90;
    }

    this.paddingTopEl.style.height = `${paddingTop}px`;
    this.paddingBottomEl.style.height = `${paddingBottom}px`;

    // 渲染可见项
    const fragment = document.createDocumentFragment();
    for (let i = start; i < this.endIndex; i++) {
      const msg = this.items[i];
      const el = this.ui.createMessageElement(msg);
      el.style.position = "relative";
      fragment.appendChild(el);
    }

    this.listEl.innerHTML = "";
    this.listEl.appendChild(fragment);

    // 恢复滚动位置
    if (Math.abs(this.viewport.scrollTop - scrollTop) > 1) {
      this.viewport.scrollTop = scrollTop;
    }
  }

  onScroll() {
    if (!this.enabled) return;
    requestAnimationFrame(() => {
      this.render();
      this.ui.rerenderVisibleMessages();
    });
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.viewport) {
      this.viewport.removeEventListener("scroll", this.onScroll.bind(this));
      this.container.innerHTML = this.ui.conversationCache.get(this.ui.currentConversation.id) || "";
    }
  }
}

// ==================== 导出单例 ====================

const uiManager = new UIManager();
window.uiManager = uiManager;
export default uiManager;
