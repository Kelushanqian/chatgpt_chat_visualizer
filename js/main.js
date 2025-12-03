// 主入口文件
import chatDB from "./db.js";
import {
  processConversationsData,
  aggregateDailyMessageCounts,
  calculateStatistics,
} from "./parser.js";
import { favoritesManager } from "./favorites.js";
import uiManager from "./ui.js";
import { formatDate } from "./ui.js";

// 初始化应用
async function initApp() {
  try {
    // 初始化数据库
    await chatDB.init();
    console.log("数据库初始化成功");

    // 初始化收藏管理器
    await favoritesManager.init();

    // 设置事件监听
    setupFileHandling();
    setupSearch();
    setupThemeToggle();
    // loadTheme();

    // 尝试从数据库加载已有数据
    const conversations = await chatDB.getAllConversations();
    if (conversations.length > 0) {
      await loadDataFromDB(conversations);
    } else {
      uiManager.showEmptyState();
    }
  } catch (error) {
    console.error("应用初始化失败，请尝试清除网页缓存");
    uiManager.showEmptyState();
  }
}

// 从数据库加载数据
async function loadDataFromDB(conversations) {
  conversations.sort((a, b) => (b.create_time || 0) - (a.create_time || 0));
  uiManager.allConversations = conversations;

  const stats = calculateStatistics(conversations);
  uiManager.updateStatistics(stats);
  uiManager.renderConversationList(uiManager.allConversations);

  const dailyCounts = aggregateDailyMessageCounts(conversations);
  uiManager.renderDailyTrendChart(dailyCounts);
  await uiManager.renderFavoritesList();
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

// 搜索
function setupSearch() {
  const searchBox = document.getElementById("searchBox");
  const searchContentBox = document.getElementById("searchContentBox");
  const sortSelect = document.getElementById("sortSelect");

  searchBox.addEventListener("input", () => {
    searchContentBox.value = "";
    const searchTerm = searchBox.value;
    const sortBy = 'update' || sortSelect.value;
    uiManager.filterConversations(searchTerm, sortBy);
  });

  searchContentBox.addEventListener("input", () => {
    searchBox.value = "";
    const searchTerm = searchContentBox.value;
    const sortBy = 'update' || sortSelect.value;
    uiManager.filterConversationsByContent(searchTerm, sortBy);
  });

  sortSelect.addEventListener("change", () => {
    searchContentBox.value = "";
    const searchTerm = searchBox.value;
    const sortBy = sortSelect.value;
    uiManager.filterConversations(searchTerm, sortBy);
  });
}

// 返回上传页面
async function backToUpload() {
  clearDatabase();
  const fileInput = document.getElementById("fileInput");
  if (fileInput) {
    fileInput.value = "";
  }
  uiManager.showEmptyState();
  document.getElementById("backToUpload").classList.add("hidden");
}

// 导出功能
async function exportAllData() {
  const conversations = await chatDB.getAllConversations(true);
  conversations.sort((a, b) => (b.create_time || 0) - (a.create_time || 0));
  const markdown = generateAllConversationsMarkdown(conversations);
  downloadMarkdown(markdown, "所有对话的MarkDown文件.md");
}

// 导出收藏对话的 Markdown
async function exportFavorites() {
  const favorites = await favoritesManager.getAllFavorites();
  if (favorites.length === 0) {
    return;
  }
  const conversations = await Promise.all(
    favorites.map((fav) => chatDB.getConversation(fav.conversationId))
  );
  const validConversations = conversations.filter((conv) => conv !== null);
  const markdown = generateAllConversationsMarkdown(validConversations);
  downloadMarkdown(markdown, "收藏的对话.md");
}

// 生成所有对话的 Markdown
function generateAllConversationsMarkdown(conversations) {
  let markdown = "";
  markdown += `export_time: ${formatDate(Date.now() / 1000)}\n\n`;
  markdown += `conversations_count: ${conversations.length}\n\n`;
  markdown += `---\n\n`;

  conversations.forEach((conv) => {
    markdown += `# ${conv.title || "未命名对话"}\n\n`;
    markdown += `create_time: ${formatDate(conv.create_time)}\n\n`;
    markdown += `messages_count: ${conv.messageCount}\n\n`;
    conv.messages.forEach((msg) => {
      // const roleLabel = msg.role === "user" ? "You" : "Agent";
      // markdown += `**${roleLabel}**\n\n`;
      markdown += `${msg.content}\n\n`;
      markdown += `*${formatDate(msg.createTime)}*\n\n`;
    });
    markdown += `\n---\n\n`;
  });

  return markdown;
}

// 下载 Markdown 文件
function downloadMarkdown(content, filename) {
  const blob = new Blob([content], {
    type: "text/markdown;charset=utf-8",
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
  const Theme = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
  setTheme(Theme);
  // saveTheme(Theme);
}

function setTheme(theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
}

// function saveTheme(theme) {
//   localStorage.setItem("chatgpt-viewer-theme", theme);
//   console.log('已保存主题')
// }

// function loadTheme() {
//   try {
//     const savedTheme = localStorage.getItem("chatgpt-viewer-theme");
//     const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
//       .matches
//       ? "dark"
//       : "light";
//     const theme = savedTheme || systemTheme;
//     setTheme(theme);
//   } catch (error) {
//     setTheme("light");
//   }
// }

// 清空数据库
async function clearDatabase() {
  await chatDB.clearAll();
  await favoritesManager.init();
  console.log("数据库已清除");
}

// 全局导出供HTML调用
window.backToUpload = backToUpload;
window.exportAllData = exportAllData;
window.exportFavorites = exportFavorites;
window.clearDatabase = clearDatabase;

// 启动应用
document.addEventListener("DOMContentLoaded", initApp);
