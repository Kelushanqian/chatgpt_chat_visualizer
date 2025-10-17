//全局变量
let conversationsData = [];
let currentConversation = null;
let filteredConversations = [];

//配置marked.js
if (typeof marked !== "undefined") {
  marked.setOptions({
    breaks: true,
    gfm: true,
    sanitize: false,
    smartLists: true,
    smartypants: true,
  });
}

//初始化
document.addEventListener("DOMContentLoaded", function () {
  setupFileHandling();
  setupSearch();
  setupThemeToggle();
  loadTheme();
  showEmptyState();
});

//消息处理

function extractMessages(conversation) {
  const messages = [];
  let currentNode = conversation.current_node;

  // 沿着对话路径追溯
  while (currentNode != null) {
    const node = conversation.mapping[currentNode];
    if (!node) break;

    if (isValidMessage(node)) {
      const message = processMessage(node);
      if (message) messages.unshift(message);
    }
    currentNode = node.parent;
  }

  // 合并连续同角色消息并返回
  return mergeConsecutiveMessages(messages);
}

function mergeConsecutiveMessages(messages) {
  if (messages.length === 0) return [];
  const mergedMessages = [];
  let currentMergedMsg = { ...messages[0] };
  for (let i = 1; i < messages.length; i++) {
    const nextMsg = messages[i];
    // 如果角色相同，则合并内容并更新时间戳
    if (nextMsg.role === currentMergedMsg.role) {
      const newContent = nextMsg.content || "";
      // 使用三元运算符避免不必要的字符串拼接
      currentMergedMsg.content +=
        (currentMergedMsg.content ? "\n" : "") + newContent;
      // 始终取最新的更新时间
      const nextUpdateTime = nextMsg.updateTime || nextMsg.createTime || 0;
      const currentUpdateTime =
        currentMergedMsg.updateTime || currentMergedMsg.createTime || 0;
      currentMergedMsg.updateTime = Math.max(currentUpdateTime, nextUpdateTime);
    } else {
      mergedMessages.push(currentMergedMsg);
      currentMergedMsg = { ...nextMsg };
    }
  }
  if (currentMergedMsg) {
    mergedMessages.push(currentMergedMsg);
  }
  return mergedMessages;
}

function isValidMessage(node) {
  if (!node.message || !node.message.content || !node.message.content.parts) {
    return false;
  }

  const msg = node.message;
  const role = msg.author?.role;

  // 跳过空消息和系统消息
  if (role === "system" || msg.content.parts.length === 0) {
    return false;
  }

  // 跳过隐藏消息
  if (msg.metadata?.is_visually_hidden_from_conversation) {
    return false;
  }

  return true;
}

function processMessage(node) {
  const msg = node.message;

  // 识别角色
  let role = "user";
  const authorRole = msg.author?.role || "unknown";
  if (authorRole === "assistant" || authorRole === "tool") {
    role = "assistant";
  } else if (authorRole === "system") {
    role = "system";
  }

  // 提取文本内容
  const content = msg.content.parts
    .filter((part) => typeof part === "string" && part.trim())
    .join("\n")
    .trim();

  if (!content) return null;

  return {
    id: msg.id || node.id,
    role: role,
    content: content,
    createTime: msg.create_time || 0,
    updateTime: msg.update_time || 0,
  };
}

function processConversationsData(data) {
  try {
    conversationsData = Array.isArray(data) ? data : [data];

    conversationsData.forEach((conv, index) => {
      try {
        const messages = extractMessages(conv);
        conv.messages = messages;
        conv.messageCount = messages.length;
        conv.userMessageCount = messages.filter(
          (m) => m.role === "user"
        ).length;
        conv.assistantMessageCount = messages.filter(
          (m) => m.role === "assistant"
        ).length;
        conv.lastUpdate = conv.update_time || conv.create_time || 0;
      } catch (error) {
        console.error(`处理对话 ${index} 时出错:`, error);
        conv.messages = [];
        conv.messageCount = 0;
        conv.userMessageCount = 0;
        conv.assistantMessageCount = 0;
      }
    });

    filteredConversations = [...conversationsData];
    hideLoading();
    showDashboard();
    updateStatistics();
    renderConversationList();
    const dailyCounts = aggregateDailyMessageCounts(conversationsData);
    renderDailyTrendChart(dailyCounts);
  } catch (error) {
    console.error("处理对话数据时出错:", error);
    alert("处理数据时出错，请检查文件格式");
    showEmptyState();
  }
}

function aggregateDailyMessageCounts(conversations) {
  const dailyCounts = {};

  conversations.forEach((conv) => {
    // 假设您已经优化了 extractMessages，它返回了按时间排序的合并消息
    const messages = extractMessages(conv);

    messages.forEach((msg) => {
      // 检查创建时间戳
      if (msg.createTime) {
        const date = new Date(msg.createTime * 1000);

        // 提取 YYYY-MM-DD 格式的日期
        const dateKey = date.toISOString().split("T")[0];

        dailyCounts[dateKey] = (dailyCounts[dateKey] || 0) + 1;
      }
    });
  });

  // 返回按日期排序的数组，方便图表绘制
  const sortedData = Object.entries(dailyCounts)
    .sort(([dateA], [dateB]) => new Date(dateA) - new Date(dateB))
    .map(([date, count]) => ({ date, count }));

  return sortedData;
}

//文件处理

function setupFileHandling() {
  const fileInput = document.getElementById("fileInput");
  const uploadArea = document.querySelector(".upload-area");

  fileInput.addEventListener("change", handleFileSelect);

  // 拖拽上传
  uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("dragover");
  });

  uploadArea.addEventListener("dragleave", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("dragover");
  });

  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("dragover");
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
  });
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) handleFile(file);
}

function handleFile(file) {
  if (!file.name.endsWith(".json")) {
    alert("请选择JSON文件");
    return;
  }

  showLoading();
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      processConversationsData(data);
    } catch (error) {
      alert("文件格式错误，无法读取");
      console.error("JSON解析错误:", error);
      showEmptyState();
    }
  };
  reader.readAsText(file);
}

//界面渲染

function updateStatistics() {
  const totalMessages = conversationsData.reduce(
    (sum, conv) => sum + conv.messageCount,
    0
  );
  const totalUserMessages = conversationsData.reduce(
    (sum, conv) => sum + conv.userMessageCount,
    0
  );
  const totalAssistantMessages = conversationsData.reduce(
    (sum, conv) => sum + conv.assistantMessageCount,
    0
  );

  document.getElementById("totalConversations").textContent =
    conversationsData.length;
  document.getElementById("totalMessages").textContent = totalMessages;
  document.getElementById("userMessages").textContent = totalUserMessages;
  document.getElementById("assistantMessages").textContent =
    totalAssistantMessages;
}

function renderConversationList() {
  const container = document.getElementById("conversationList");

  if (filteredConversations.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><p>没有找到匹配的对话</p></div>';
    return;
  }

  const html = filteredConversations
    .map(
      (conv) => `
      <div class="conversation-item" onclick="selectConversation('${
        conv.id || conv.title
      }', this)">
        <div class="conversation-title">
          ${escapeHtml(conv.title || "未命名对话")}
        </div>
        <div class="conversation-meta">
          ${conv.messageCount} 条消息 | ${formatDate(conv.lastUpdate)}
        </div>
      </div>
    `
    )
    .join("");

  container.innerHTML = html;
}

function selectConversation(id, element) {
  currentConversation = conversationsData.find(
    (conv) => (conv.id || conv.title) === id
  );
  if (!currentConversation) return;

  // 更新UI状态
  document.querySelectorAll(".conversation-item").forEach((item) => {
    item.classList.remove("active");
  });
  if (element) element.classList.add("active");

  displayConversation(currentConversation);
  document.getElementById("exportBtn").style.display = "inline-block";
}

function displayConversation(conversation) {
  const title = document.getElementById("conversationTitle");
  const container = document.getElementById("messagesContainer");

  title.textContent = conversation.title;
  const messages = conversation.messages;

  const html = messages.map((msg) => renderMessage(msg)).join("");

  container.innerHTML = html;
  container.scrollTop = 0;
}

function renderMessage(msg) {
  const roleClass = msg.role;
  const displayName = msg.role === "user" ? "You" : "Agent";
  const contentHtml = renderMarkdown(msg.content);
  const editInfo =
    msg.updateTime && msg.updateTime !== msg.createTime ? " (已编辑)" : "";

  return `
    <div class="message ${roleClass}">
      <div class="message-author">${displayName}</div>
      <div class="message-content">${contentHtml}</div>
      <div class="message-time">
        ${formatDate(msg.createTime)}${editInfo}
      </div>
    </div>
  `;
}

function renderDailyTrendChart(dailyData) {
  const container = document.getElementById("dailyTrendChart");

  // 确保容器是空的
  container.innerHTML = "";

  // 找出最大值，用于计算柱子高度
  const maxCount = Math.max(...dailyData.map((d) => d.count));

  const chartInner = document.createElement("div");
  chartInner.className = "chart-inner";

  // 只显示最近 30 天的数据，避免图表过于拥挤
  const dataToShow = dailyData.slice(-30);

  dataToShow.forEach((item) => {
    const bar = document.createElement("div");
    const heightPercent = (item.count / maxCount) * 100;

    bar.className = "chart-bar";
    bar.style.height = `${heightPercent}%`;

    // 添加工具提示 (title)
    bar.title = `${item.date}: ${item.count} 条`;

    // 限制每个柱子的宽度，保持美观
    bar.style.flex = "1 1 0"; // 灵活布局，保证柱子均匀分布

    chartInner.appendChild(bar);
  });

  container.appendChild(chartInner);

  // 可选：添加底部日期标签（省略以保持代码简洁，但这对于实际图表很重要）
}

//搜索和排序

function setupSearch() {
  const searchBox = document.getElementById("searchBox");
  const sortSelect = document.getElementById("sortSelect");

  searchBox.addEventListener("input", filterConversations);
  sortSelect.addEventListener("change", filterConversations);
}

function filterConversations() {
  const searchTerm = document.getElementById("searchBox").value.toLowerCase();
  const sortBy = document.getElementById("sortSelect").value;

  // 搜索过滤
  filteredConversations = conversationsData.filter((conv) =>
    (conv.title || "").toLowerCase().includes(searchTerm)
  );

  // 排序
  switch (sortBy) {
    case "time":
      filteredConversations.sort(
        (a, b) => (b.lastUpdate || 0) - (a.lastUpdate || 0)
      );
      break;
    case "messages":
      filteredConversations.sort((a, b) => b.messageCount - a.messageCount);
      break;
    case "title":
      filteredConversations.sort((a, b) =>
        (a.title || "").localeCompare(b.title || "")
      );
      break;
  }

  renderConversationList();
}

//导出功能

function exportConversation() {
  if (!currentConversation) {
    alert("请先选择一个对话");
    return;
  }

  const exportData = {
    title: currentConversation.title,
    create_time: currentConversation.create_time,
    update_time: currentConversation.update_time,
    messages: currentConversation.messages,
    message_count: currentConversation.messageCount,
  };

  downloadJSON(
    exportData,
    `conversation_${currentConversation.title || "untitled"}.json`
  );
}

function exportAllData() {
  const exportData = {
    export_time: Date.now(),
    total_conversations: conversationsData.length,
    conversations: conversationsData.map((conv) => ({
      title: conv.title,
      create_time: conv.create_time,
      update_time: conv.update_time,
      messages: conv.messages,
      message_count: conv.messageCount,
    })),
  };

  downloadJSON(exportData, "all_conversations_export.json");
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

//状态管理

function showLoading() {
  document.getElementById("uploadSection").style.display = "none";
  document.getElementById("loading").classList.remove("hidden");
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("dashboard").classList.add("hidden");
}

function hideLoading() {
  document.getElementById("loading").classList.add("hidden");
}

function showDashboard() {
  document.getElementById("uploadSection").style.display = "none";
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
}

function showEmptyState() {
  document.getElementById("uploadSection").style.display = "block";
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("dashboard").classList.add("hidden");
}

//工具函数

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

//主题切换

/**
 * 设置主题切换功能
 */
function setupThemeToggle() {
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", toggleTheme);
  }
}

/**
 * 切换主题
 */
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const newTheme = currentTheme === "dark" ? "light" : "dark";

  setTheme(newTheme);
  saveTheme(newTheme);
}

/**
 * 设置主题
 */
function setTheme(theme) {
  const root = document.documentElement;

  root.setAttribute("data-theme", theme);

  setTimeout(() => {
    root.style.transition = "";
  }, 300);
}

/**
 * 保存主题到本地存储
 */
function saveTheme(theme) {
  try {
    localStorage.setItem("chatgpt-viewer-theme", theme);
  } catch (error) {
    console.warn("无法保存主题设置:", error);
  }
}

/**
 * 从本地存储加载主题
 */
function loadTheme() {
  try {
    const savedTheme = localStorage.getItem("chatgpt-viewer-theme");
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
      .matches
      ? "dark"
      : "light";
    const theme = savedTheme || systemTheme;

    setTheme(theme);
  } catch (error) {
    setTheme("light"); // 默认浅色主题
  }
}
