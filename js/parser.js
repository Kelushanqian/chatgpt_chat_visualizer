// 消息处理和数据解析

// 提取对话中的消息
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

// 合并连续的相同角色消息
function mergeConsecutiveMessages(messages) {
  if (messages.length === 0) return [];
  const mergedMessages = [];
  let currentMergedMsg = { ...messages[0] };

  for (let i = 1; i < messages.length; i++) {
    const nextMsg = messages[i];
    // 如果角色相同，则合并内容并更新时间戳
    if (nextMsg.role === currentMergedMsg.role) {
      const newContent = nextMsg.content || "";
      currentMergedMsg.content +=
        (currentMergedMsg.content ? "\n" : "") + newContent;
      // 始终取最新的更新时间
      const nextCreateTime = nextMsg.createTime || 0;
      const currentCreateTime =
        currentMergedMsg.createTime || 0;
      currentMergedMsg.createTime = Math.max(currentCreateTime, nextCreateTime);
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

// 验证消息是否有效
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

// 处理单条消息
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
  };
}

// 处理对话数据
function processConversationsData(data) {
  const conversationsData = Array.isArray(data) ? data : [data];

  conversationsData.forEach((conv, index) => {
    try {
      const messages = extractMessages(conv);
      conv.messages = messages;
      conv.messageCount = messages.length;
      conv.userMessageCount = messages.filter((m) => m.role === "user").length;
      conv.assistantMessageCount = messages.filter(
        (m) => m.role === "assistant"
      ).length;
      conv.lastCreate = conv.create_time || 0;
    } catch (error) {
      console.error(`处理对话 ${index} 时出错:`, error);
      conv.messages = [];
      conv.messageCount = 0;
      conv.userMessageCount = 0;
      conv.assistantMessageCount = 0;
    }
  });

  return conversationsData;
}

// 聚合每日消息统计
function aggregateDailyMessageCounts(conversations) {
  const dailyCounts = {};

  conversations.forEach((conv) => {
    const messages = conv.messages || extractMessages(conv);

    messages.forEach((msg) => {
      if (msg.createTime) {
        const date = new Date(msg.createTime * 1000);
        const dateKey = date.toISOString().split("T")[0];
        dailyCounts[dateKey] = (dailyCounts[dateKey] || 0) + 1;
      }
    });
  });

  // 返回按日期排序的数组
  const sortedData = Object.entries(dailyCounts)
    .sort(([dateA], [dateB]) => new Date(dateA) - new Date(dateB))
    .map(([date, count]) => ({ date, count }));

  return sortedData;
}

// 计算统计数据
function calculateStatistics(conversations) {
  const totalMessages = conversations.reduce(
    (sum, conv) => sum + (conv.messageCount || 0),
    0
  );
  const totalUserMessages = conversations.reduce(
    (sum, conv) => sum + (conv.userMessageCount || 0),
    0
  );
  const totalAssistantMessages = conversations.reduce(
    (sum, conv) => sum + (conv.assistantMessageCount || 0),
    0
  );

  return {
    totalConversations: conversations.length,
    totalMessages,
    totalUserMessages,
    totalAssistantMessages,
  };
}

export {
  extractMessages,
  processConversationsData,
  aggregateDailyMessageCounts,
  calculateStatistics,
};