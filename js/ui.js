// UI 渲染和交互管理
import chatDB from "./db.js";
import { favoritesManager, highlightsManager } from "./favorites.js";
import { aggregateDailyMessageCounts } from "./parser.js";

// 配置marked.js
if (typeof marked !== "undefined") {
  marked.setOptions({
    breaks: true,
    gfm: true,
    sanitize: false,
    smartLists: true,
    smartypants: true,
  });
}

// 工具函数
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  if (typeof marked !== "undefined") {
    try {
      return marked.parse(text.replace(/\n\s*\n/g, "\n\n"));
    } catch (error) {
      console.warn("Markdown解析错误:", error);
      return escapeHtml(text);
    }
  }
  return escapeHtml(text);
}

function formatDate(timestamp) {
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

// UI状态管理
class UIManager {
  constructor() {
    this.currentConversation = null;
    this.filteredConversations = [];
    this.allConversations = [];
  }

  // 更新统计数据
  updateStatistics(stats) {
    document.getElementById("totalConversations").textContent =
      stats.totalConversations;
    document.getElementById("totalMessages").textContent = stats.totalMessages;
    document.getElementById("userMessages").textContent =
      stats.totalUserMessages;
    document.getElementById("assistantMessages").textContent =
      stats.totalAssistantMessages;
  }

  // 渲染对话列表
  renderConversationList(conversations) {
    const container = document.getElementById("conversationList");

    const conversationsList = conversations.sort(
      (a, b) => (b.create_time || 0) - (a.create_time || 0)
    );

    const html = conversationsList
      .map((conv) => {
        const isFav = favoritesManager.isFavorite(conv.id || conv.title);
        const favClass = isFav ? "active" : "";

        return `
        <div 
          class="conversation-item" 
          onclick="uiManager.selectConversation('${
            conv.id || conv.title
          }', event)" 
          data-id="${conv.id || conv.title}">
          <div class="conversation-info">
            <div class="conversation-title">
              ${escapeHtml(conv.title || "未命名对话")}
            </div>
            <div class="conversation-meta">
              ${conv.messageCount} 条消息 | ${formatDate(conv.create_time)}
            </div>
          </div>

            <button class="favorite-btn ${favClass}" 
                    onclick="uiManager.toggleFavorite('${
                      conv.id || conv.title
                    }', event)"
                    title="${isFav ? "取消收藏" : "收藏"}">
              ${isFav ? "●" : "○"}
            </button>

        </div>
      `;
      })
      .join("");

    container.innerHTML = html;
  }

  // 选择对话
  async selectConversation(id, event) {
    if (event) {
      event.stopPropagation();
    }

    // 从数据库加载完整对话数据
    const conversation = await chatDB.getConversation(id);
    if (!conversation) return;

    this.currentConversation = conversation;

    // 更新UI状态
    document.querySelectorAll(".conversation-item").forEach((item) => {
      item.classList.remove("active");
    });

    const selectedItem = document.querySelector(
      `.conversation-item[data-id="${id}"]`
    );
    if (selectedItem) {
      selectedItem.classList.add("active");
    }

    this.displayConversation(conversation);
    document.getElementById("exportBtn").style.display = "inline-block";
  }

  // 显示对话详情
  displayConversation(conversation) {
    const title = document.getElementById("conversationTitle");
    const container = document.getElementById("messagesContainer");

    title.textContent = conversation.title;
    const messages = conversation.messages || [];

    const html = messages.map((msg) => this.renderMessage(msg)).join("");

    container.innerHTML = html;
    container.scrollTop = 0;
  }

  // 渲染单条消息
  renderMessage(msg) {
    const roleClass = msg.role;
    const displayName = msg.role === "user" ? "You" : "Agent";
    const contentHtml = renderMarkdown(msg.content);

    return `
      <div class="message ${roleClass}" data-message-id="${msg.id}">
        <div class="message-author">${displayName}</div>
        <div class="message-content">${contentHtml}</div>
        <div class="message-time">
          ${formatDate(msg.createTime)}
        </div>
        <div class="message-actions">
          <button class="highlight-icon" onclick="uiManager.highlightMessage('${
            msg.id
          }')" title="高亮">
            ✎
          </button>
        </div>
      </div>
    `;
  }

  // 渲染每日趋势图
  renderDailyTrendChart(dailyData) {
    const container = document.getElementById("dailyTrendChart");
    container.innerHTML = "";
    const maxCount = Math.max(...dailyData.map((d) => d.count));
    const chartInner = document.createElement("div");
    chartInner.className = "chart-inner";

    const tooltip = document.createElement("div");
    tooltip.className = "tooltip";
    chartInner.appendChild(tooltip);

    const dataToShow = dailyData.slice(-20);
    dataToShow.forEach((item) => {
      const bar = document.createElement("div");
      const heightPercent = (item.count / maxCount) * 100;
      bar.className = "chart-bar";
      bar.style.height = `${heightPercent}%`;
      bar.title = `${item.date}: ${item.count} 条`;
      bar.style.flex = "1 1 0";

      bar.addEventListener("click", () => {
        tooltip.textContent = `${item.date}: ${item.count} 条`;
        tooltip.style.opacity = 0.8;
      });

      chartInner.appendChild(bar);
    });

    container.appendChild(chartInner);

    // 点击空白处关闭
    document.addEventListener("click", (e) => {
      if (!chartInner.contains(e.target)) {
        tooltip.style.opacity = 0;
      }
    });
  }

  // 渲染收藏列表
  async renderFavoritesList() {
    const container = document.getElementById("favoritesList");
    const favorites = await favoritesManager.getAllFavorites();

    if (favorites.length === 0) {
      document.getElementById("favoritesCount").textContent = 0;
      container.innerHTML = '<div class="empty-state"><p>暂无收藏</p></div>';
      return;
    }

    const html = favorites
      .map((fav) => {
        return `
        <div class="favorite-item" onclick="uiManager.selectConversation('${
          fav.conversationId
        }')">
          <div class="favorite-title">${escapeHtml(
            fav.title || "未命名对话"
          )}</div>
          <div class="favorite-time">${formatDate(fav.timestamp / 1000)}</div>
        </div>
      `;
      })
      .join("");

    container.innerHTML = html;

    // 更新收藏统计
    document.getElementById("favoritesCount").textContent = favorites.length;
  }

  // 切换收藏状态
  async toggleFavorite(conversationId, event) {
    if (event) {
      event.stopPropagation();
    }

    const conversation = this.allConversations.find(
      (c) => (c.id || c.title) === conversationId
    );

    const isFavorited = await favoritesManager.toggleFavorite(
      conversationId,
      conversation
    );

    // 更新按钮状态
    const btn = document.querySelector(
      `.conversation-item[data-id="${conversationId}"] .favorite-btn`
    );
    if (btn) {
      if (isFavorited) {
        btn.classList.add("active");
        btn.textContent = "●";
        btn.title = "取消收藏";
      } else {
        btn.classList.remove("active");
        btn.textContent = "○";
        btn.title = "收藏";
      }
    }

    // 刷新收藏列表
    await this.renderFavoritesList();
  }

  async renderHighlightsList() {
    const container = document.getElementById("highlightsList");
    const highlights = highlightsManager.getAllHighlights();

    // 更新高亮统计数
    if (highlights.length === 0) {
      document.getElementById("highlightsCount").textContent = 0;
      container.innerHTML = '<div class="empty-state"><p>暂无高亮</p></div>';
      return;
    }

    const html = highlights
      .map((hl) => {
        // 查找对应的对话标题
        const conv = this.allConversations.find(
          (c) => (c.id || c.title) === hl.conversationId
        );
        const conversationTitle = conv?.title || "未命名对话";
        return `
      <div class="highlight-item ${
        hl.color
      }" onclick="uiManager.selectConversation('${hl.conversationId}')">
        <div class="highlight-text">${escapeHtml(hl.text)}</div>
        <div class="highlight-title">${escapeHtml(
          conversationTitle
        )}</div>
      </div>
    `;
      })
      .join("");

    container.innerHTML = html;
    document.getElementById("highlightsCount").textContent = highlights.length;
  }

  async highlightMessage(messageId) {

    const colors = ["yellow", "blue", "green"];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (text) {
      await highlightsManager.addHighlight(
        this.currentConversation.id || this.currentConversation.title,
        messageId,
        text,
        color
      );
      console.log("已添加高亮");
      await this.renderHighlightsList();
    } else {
      console.log("请先选择要高亮的文本");
    }
  }

  // 筛选对话
  filterConversations(searchTerm, sortBy) {
    // 搜索过滤
    this.filteredConversations = this.allConversations.filter((conv) =>
      (conv.title || "").toLowerCase().includes(searchTerm.toLowerCase())
    );

    // 排序
    switch (sortBy) {
      case "time":
        this.filteredConversations.sort(
          (a, b) => (b.create_time || 0) - (a.create_time || 0)
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
      case "favorites":
        this.filteredConversations = this.filteredConversations.filter((conv) =>
          favoritesManager.isFavorite(conv.id || conv.title)
        );
        break;
    }

    this.renderConversationList(this.filteredConversations);
  }

  // 显示/隐藏界面元素
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

// 导出单例
const uiManager = new UIManager();

// 全局导出供HTML调用
window.uiManager = uiManager;

export default uiManager;
