// 主入口文件
import chatDB from "./db.js";
import {
  processConversationsData,
  aggregateDailyMessageCounts,
  calculateStatistics,
} from "./parser.js";
import { favoritesManager, highlightsManager } from "./favorites.js";
import uiManager from "./ui.js";

// 初始化应用
async function initApp() {
  try {
    // 初始化数据库
    await chatDB.init();
    console.log("数据库初始化成功");

    // 初始化收藏管理器
    await favoritesManager.init();
    await highlightsManager.init();
    console.log("收藏数据加载成功");

    // 设置事件监听
    setupFileHandling();
    setupSearch();
    setupThemeToggle();
    loadTheme();

    // 尝试从数据库加载已有数据
    const conversations = await chatDB.getAllConversations();
    if (conversations.length > 0) {
      await loadDataFromDB(conversations);
    } else {
      uiManager.showEmptyState();
    }
  } catch (error) {
    console.error("应用初始化失败:", error);
    uiManager.showEmptyState();
  }
}

// 从数据库加载数据
async function loadDataFromDB(conversations) {
  uiManager.allConversations = conversations;
  uiManager.filteredConversations = [...conversations];

  const stats = calculateStatistics(conversations);
  uiManager.updateStatistics(stats);
  uiManager.renderConversationList(uiManager.filteredConversations);

  // 为了生成趋势图，需要从数据库加载完整的消息数据
  const conversationsWithMessages = await Promise.all(
    conversations.slice(0, 50).map(async (conv) => {
      const fullConv = await chatDB.getConversation(conv.id || conv.title);
      return fullConv || conv;
    })
  );

  const dailyCounts = aggregateDailyMessageCounts(conversationsWithMessages);
  uiManager.renderDailyTrendChart(dailyCounts);
  await uiManager.renderFavoritesList();
  await uiManager.renderHighlightsList();

  uiManager.showDashboard();
}

// 文件处理
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

async function handleFile(file) {
  if (!file.name.endsWith(".json")) {
    alert("请选择JSON文件");
    return;
  }

  uiManager.showLoading();

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = JSON.parse(e.target.result);
      const conversations = processConversationsData(data);

      // 保存到 IndexedDB
      await chatDB.saveConversations(conversations);
      console.log("数据已保存到数据库");

      // 加载并显示数据
      await loadDataFromDB(conversations);
    } catch (error) {
      alert("文件格式错误，无法读取");
      console.error("JSON解析错误:", error);
      uiManager.showEmptyState();
    }
  };
  reader.readAsText(file);
}

// 搜索和排序
function setupSearch() {
  const searchBox = document.getElementById("searchBox");
  const sortSelect = document.getElementById("sortSelect");

  searchBox.addEventListener("input", () => {
    const searchTerm = searchBox.value;
    const sortBy = sortSelect.value;
    uiManager.filterConversations(searchTerm, sortBy);
  });

  sortSelect.addEventListener("change", () => {
    const searchTerm = searchBox.value;
    const sortBy = sortSelect.value;
    uiManager.filterConversations(searchTerm, sortBy);
  });
}

// 返回上传页面
async function backToUpload() {
  const confirmClear = confirm(
    "返回上传页面将清空当前数据，是否继续？\n（数据仍保存在浏览器中，可重新打开页面恢复）"
  );

  if (!confirmClear) return;

  uiManager.currentConversation = null;
  uiManager.filteredConversations = [];
  uiManager.allConversations = [];

  const fileInput = document.getElementById("fileInput");
  if (fileInput) {
    fileInput.value = "";
  }

  uiManager.showEmptyState();
  document.getElementById("backToUpload").classList.add("hidden");
}

// 导出功能
async function exportConversation() {
  if (!uiManager.currentConversation) {
    alert("请先选择一个对话");
    return;
  }

  const conversation = uiManager.currentConversation;
  const exportData = {
    title: conversation.title,
    create_time: conversation.create_time,
    messages: conversation.messages,
    message_count: conversation.messageCount,
  };

  downloadJSON(
    exportData,
    `conversation_${conversation.title || "untitled"}.json`
  );
}

async function exportAllData() {
  const conversations = await chatDB.getAllConversations();
  const exportData = {
    export_time: Date.now(),
    total_conversations: conversations.length,
    conversations: conversations.map((conv) => ({
      title: conv.title,
      message_count: conv.messageCount,
      messages: conv.messages,
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

// 主题切换
function setupThemeToggle() {
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", toggleTheme);
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const newTheme = currentTheme === "dark" ? "light" : "dark";
  setTheme(newTheme);
  saveTheme(newTheme);
}

function setTheme(theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);

  setTimeout(() => {
    root.style.transition = "";
  }, 300);
}

function saveTheme(theme) {
  try {
    localStorage.setItem("chatgpt-viewer-theme", theme);
  } catch (error) {
    console.warn("无法保存主题设置:", error);
  }
}

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
    setTheme("light");
  }
}

// 清空数据库
async function clearDatabase() {
  const confirm = window.confirm(
    "确定要清空所有数据吗？此操作不可恢复！"
  );
  if (!confirm) return;

  try {
    await chatDB.clearAll();
    await favoritesManager.init();
    await highlightsManager.init();
    alert("数据已清空");
    backToUpload();
  } catch (error) {
    console.error("清空数据失败:", error);
    alert("清空数据失败");
  }
}

// 全局导出供HTML调用
window.backToUpload = backToUpload;
window.exportConversation = exportConversation;
window.exportAllData = exportAllData;
window.clearDatabase = clearDatabase;

// 启动应用
document.addEventListener("DOMContentLoaded", initApp);