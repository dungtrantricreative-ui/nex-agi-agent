const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Cổng API thông qua Cloudflare Worker Load Balancer đã phân tải key của bạn
const WORKER_URL = "https://openrouter-api.dungtrantricreative.workers.dev/v1/chat/completions";
const MODEL_NAME = "nex-agi/nex-n2-pro:free";

// Khai báo tập hợp Công cụ (Tools) theo định dạng tiêu chuẩn OpenAI / OpenRouter
const agentTools = [
  {
    type: "function",
    function: {
      name: "execute_terminal",
      description: "Thực thi lệnh shell/terminal trực tiếp trên hệ thống máy chủ và lấy kết quả trả về.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Lệnh shell cần thực thi (Ví dụ: 'ls -la', 'node -v', 'npm install package')." }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "manage_file",
      description: "Đọc nội dung hoặc tạo mới/ghi đè một tệp tin mã nguồn trong thư mục dự án.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["write", "read"], description: "Hành động: 'write' để ghi hoặc 'read' để đọc tệp." },
          filename: { type: "string", description: "Tên tệp tin (Ví dụ: 'test.js', 'output.txt')." },
          content: { type: "string", description: "Nội dung văn bản/mã nguồn cần viết vào tệp (Bắt buộc nếu action là 'write')." }
        },
        required: ["action", "filename"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "deep_search",
      description: "Thực hiện tìm kiếm siêu sâu trên mạng Internet, cào dữ liệu qua hàng loạt chỉ mục (>100 nguồn) để thu thập thông tin phân tích diện rộng.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Từ khóa hoặc truy vấn tìm kiếm chuyên sâu." }
        },
        required: ["query"]
      }
    }
  }
];

// Hàm xử lý Terminal vật lý
function runTerminalCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 45000 }, (error, stdout, stderr) => {
      resolve({
        output: stdout || "",
        error: stderr || (error ? error.message : "")
      });
    });
  });
}

// Hàm Tìm kiếm cực sâu quét đồng thời hơn 100 nguồn dữ liệu (Pagination qua DuckDuckGo HTML)
async function performDeepSearch(query) {
  const aggregatedResults = [];
  // Phân trang s=0, s=30, s=60, s=90, s=120 để cào đồng thời ~150 nguồn links dữ liệu
  const pages = [0, 30, 60, 90, 120];

  for (const offset of pages) {
    try {
      const targetUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${offset}`;
      const response = await fetch(targetUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      });
      if (!response.ok) continue;
      
      const htmlText = await response.text();
      // Regex bóc tách thẻ chứa trích dẫn snippet và đường dẫn nguồn từ phiên bản HTML gọn nhẹ
      const snippetMatches = htmlText.matchAll(/<a class="result__snippet"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g);
      
      let itemsFound = 0;
      for (const match of snippetMatches) {
        let actualUrl = match[1];
        if (actualUrl.includes("uddg=")) {
          actualUrl = decodeURIComponent(actualUrl.split("uddg=")[1].split("&")[0]);
        }
        const textSnippet = match[2].replace(/<[^>]*>/g, '').trim();
        aggregatedResults.push({
          id: aggregatedResults.length + 1,
          url: actualUrl,
          snippet: textSnippet
        });
        itemsFound++;
      }

      // Dự phòng nếu cấu trúc giao diện thay đổi, quét thêm lớp URL thô để bảo toàn số lượng nguồn
      if (itemsFound === 0) {
        const urlMatches = htmlText.matchAll(/<a class="result__url"[^>]*href="([^"]+)"[^>]*>/g);
        for (const match of urlMatches) {
          let fallbackUrl = match[1];
          if (fallbackUrl.includes("uddg=")) fallbackUrl = decodeURIComponent(fallbackUrl.split("uddg=")[1].split("&")[0]);
          if (!aggregatedResults.some(res => res.url === fallbackUrl)) {
            aggregatedResults.push({ id: aggregatedResults.length + 1, url: fallbackUrl, snippet: "Nguồn dữ liệu chuyên sâu." });
          }
        }
      }
    } catch (err) {
      console.error(`Lỗi cào dữ liệu tại phân đoạn mạng ${offset}:`, err.message);
    }
  }
  return aggregatedResults.slice(0, 140); // Cắt lấy quanh mốc 100-130 nguồn tối đa để tránh quá tải Token hạ tầng
}

// Vòng lặp Agentic API chính
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  let conversationHistory = [...messages];
  let executionLogs = []; // Lưu trữ tiến trình thực thi công cụ trả về giao diện cho người dùng giám sát
  let iterations = 0;
  const LIMIT_ITERATIONS = 7; // Giới hạn số lần suy nghĩ gọi tool liên tục của Agent nhằm tránh lặp vô hạn

  while (iterations < LIMIT_ITERATIONS) {
    iterations++;
    try {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: conversationHistory,
          tools: agentTools,
          tool_choice: "auto"
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(500).json({ error: "Lỗi kết nối hạ tầng Worker Proxy", details: errorText });
      }

      const payload = await response.json();
      const aiMessage = payload.choices[0].message;

      // Đưa phản hồi hiện tại vào chuỗi lịch sử hội thoại toàn cục
      conversationHistory.push(aiMessage);

      // Nếu mô hình quyết định tự trả lời bằng văn bản thay vì gọi công cụ, kết thúc vòng lặp
      if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
        return res.json({
          reply: aiMessage.content,
          logs: executionLogs,
          history: conversationHistory
        });
      }

      // Xử lý song song chuỗi yêu cầu thực thi các Tool được phân công
      for (const tool of aiMessage.tool_calls) {
        const toolName = tool.function.name;
        let toolArguments = {};
        try {
          toolArguments = JSON.parse(tool.function.arguments);
        } catch (e) {
          toolArguments = { raw: tool.function.arguments };
        }

        let currentToolOutput = "";

        if (toolName === "execute_terminal") {
          executionLogs.push({ type: "terminal", action: `Đang chạy Terminal: ${toolArguments.command}` });
          const out = await runTerminalCommand(toolArguments.command);
          currentToolOutput = JSON.stringify(out);
          executionLogs.push({ type: "terminal_res", data: currentToolOutput });

        } else if (toolName === "manage_file") {
          const { action, filename, content } = toolArguments;
          const targetFilePath = path.join(__dirname, filename);

          if (action === "write") {
            executionLogs.push({ type: "file", action: `Đang khởi tạo/ghi đè file: ${filename}` });
            fs.writeFileSync(targetFilePath, content || "", "utf-8");
            currentToolOutput = `Tệp ${filename} đã được Đặc vụ tạo và ghi nhận dữ liệu thành công.`;
          } else if (action === "read") {
            executionLogs.push({ type: "file", action: `Đang tiến hành đọc nội dung file: ${filename}` });
            if (fs.existsSync(targetFilePath)) {
              currentToolOutput = fs.readFileSync(targetFilePath, "utf-8");
            } else {
              currentToolOutput = `Lỗi hệ thống: Tập tin '${filename}' không tìm thấy trên vùng không gian làm việc cục bộ.`;
            }
          }
          executionLogs.push({ type: "file_res", data: currentToolOutput });

        } else if (toolName === "deep_search") {
          executionLogs.push({ type: "search", action: `Đang kích hoạt Siêu Tìm Kiếm (>100 nguồn) cho từ khóa: "${toolArguments.query}"` });
          const searchMeta = await performDeepSearch(toolArguments.query);
          currentToolOutput = JSON.stringify(searchMeta);
          executionLogs.push({ type: "search_res", action: `Đặc vụ đã quét sâu thành công gói thông tin gồm ${searchMeta.length} nguồn tài liệu độc lập.` });
        }

        // Đồng bộ hóa kết quả thực thi công cụ vào luồng tin nhắn hệ thống gửi lại cho Nex-N2-Pro
        conversationHistory.push({
          role: "tool",
          tool_call_id: tool.id,
          name: toolName,
          content: currentToolOutput
        });
      }

    } catch (err) {
      return res.status(502).json({ error: "Sự cố đứt gãy luồng xử lý Đặc vụ tự động", details: err.message });
    }
  }

  // Phương án dự phòng khẩn cấp nếu chuỗi suy nghĩ vượt ngưỡng vòng lặp an toàn
  const lastAvailableMsg = conversationHistory[conversationHistory.length - 1];
  return res.json({
    reply: lastAvailableMsg?.content || "Hệ thống dừng khẩn cấp để bảo vệ băng thông xử lý.",
    logs: executionLogs,
    history: conversationHistory
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Hệ thống Web App Agent đang hoạt động trơn tru tại cổng mạng: ${PORT}`);
});
