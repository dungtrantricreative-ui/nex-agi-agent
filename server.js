const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();

// Định nghĩa cấu hình môi trường
const WORKER_URL = "https://openrouter-api.dungtrantricreative.workers.dev/v1/chat/completions";
const MODEL_NAME = "nex-agi/nex-n2-pro:free";

app.use(express.json());

// Ánh xạ thư mục tĩnh public thành /static để đồng bộ với index.html
app.use('/static', express.static(path.join(__dirname, 'public')));

// Trả về giao diện chính khi vào trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Khai báo tập hợp Công cụ (Tools) chuẩn OpenAI/OpenRouter cho Đặc vụ Nex-N2-Pro
const agentTools = [
    {
        type: "function",
        function: {
            name: "execute_terminal",
            description: "Thực thi lệnh shell/terminal trực tiếp trên hệ thống máy chủ và lấy kết quả trả về.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "Lệnh shell cần thực thi (Ví dụ: 'ls -la', 'npm install package')." }
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

// Hàm thực thi dòng lệnh terminal vật lý
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

// Hàm Tìm kiếm cực sâu quét đồng thời nhiều nguồn dữ liệu bằng cơ chế phân trang DuckDuckGo HTML
async function performDeepSearch(query) {
    const aggregatedResults = [];
    const pages = [0, 30, 60, 90, 120]; // Lấy đồng thời ~150 nguồn links dữ liệu

    for (const offset of pages) {
        try {
            const targetUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${offset}`;
            const response = await fetch(targetUrl, {
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
            });
            if (!response.ok) continue;
            
            const htmlText = await response.text();
            const snippetMatches = htmlText.matchAll(/<a class="result__snippet"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g);
            
            let itemsFound = 0;
            for (const match of snippetMatches) {
                let actualUrl = match[1];
                if (actualUrl.includes("uddg=")) {
                    actualUrl = decodeURIComponent(actualUrl.split("uddg=")[1].split("&")[0]);
                }
                const textSnippet = match[2].replace(/<[^>]*>/g, '').trim();
                aggregatedResults.push({
                    url: actualUrl,
                    snippet: textSnippet
                });
                itemsFound++;
            }

            if (itemsFound === 0) {
                const urlMatches = htmlText.matchAll(/<a class="result__url"[^>]*href="([^"]+)"[^>]*>/g);
                for (const match of urlMatches) {
                    let fallbackUrl = match[1];
                    if (fallbackUrl.includes("uddg=")) fallbackUrl = decodeURIComponent(fallbackUrl.split("uddg=")[1].split("&")[0]);
                    if (!aggregatedResults.some(res => res.url === fallbackUrl)) {
                        aggregatedResults.push({ url: fallbackUrl, snippet: "Nguồn dữ liệu chuyên sâu nâng cao từ Đặc vụ." });
                    }
                }
            }
        } catch (err) {
            console.error(`Lỗi cào dữ liệu tại phân đoạn ${offset}:`, err.message);
        }
    }
    return aggregatedResults.slice(0, 130);
}

// Hàm lõi xử lý Vòng lặp Đặc vụ (Agent Loop) chung cho cả 2 loại giao diện
async function handleAgentProcess(req, res) {
    // TRƯỜNG HỢP 1: Giao diện gửi dữ liệu dạng mảng lịch sử tin nhắn { messages: [...] } (Phản hồi JSON chuẩn)
    if (req.body.messages && Array.isArray(req.body.messages)) {
        let conversationHistory = [...req.body.messages];
        let executionLogs = [];
        let iterations = 0;
        const LIMIT_ITERATIONS = 7;

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

                conversationHistory.push(aiMessage);

                if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
                    return res.json({
                        reply: aiMessage.content,
                        logs: executionLogs,
                        history: conversationHistory
                    });
                }

                for (const tool of aiMessage.tool_calls) {
                    const toolName = tool.function.name;
                    let toolArguments = {};
                    try { toolArguments = JSON.parse(tool.function.arguments); } catch (e) { toolArguments = { raw: tool.function.arguments }; }

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
                            executionLogs.push({ type: "file", action: `Đang ghi file: ${filename}` });
                            fs.writeFileSync(targetFilePath, content || "", "utf-8");
                            currentToolOutput = `Tệp ${filename} đã được xử lý lưu trữ thành công.`;
                        } else if (action === "read") {
                            executionLogs.push({ type: "file", action: `Đang đọc nội dung file: ${filename}` });
                            if (fs.existsSync(targetFilePath)) {
                                currentToolOutput = fs.readFileSync(targetFilePath, "utf-8");
                            } else {
                                currentToolOutput = `Lỗi: File '${filename}' không tồn tại.`;
                            }
                        }
                        executionLogs.push({ type: "file_res", data: currentToolOutput });

                    } else if (toolName === "deep_search") {
                        executionLogs.push({ type: "search", action: `Đang cào quét dữ liệu cực sâu cho: "${toolArguments.query}"` });
                        const searchMeta = await performDeepSearch(toolArguments.query);
                        currentToolOutput = JSON.stringify(searchMeta);
                        executionLogs.push({ type: "search_res", action: `Đặc vụ thu thập thành công ${searchMeta.length} nguồn dữ liệu.` });
                    }

                    conversationHistory.push({
                        role: "tool",
                        tool_call_id: tool.id,
                        name: toolName,
                        content: currentToolOutput
                    });
                }
            } catch (err) {
                return res.status(502).json({ error: "Lỗi luồng xử lý Đặc vụ tự động", details: err.message });
            }
        }
        const lastAvailableMsg = conversationHistory[conversationHistory.length - 1];
        return res.json({ reply: lastAvailableMsg?.content || "Chu trình dừng khẩn cấp.", logs: executionLogs, history: conversationHistory });
    }

    // TRƯỜNG HỢP 2: Giao diện gửi dữ liệu dạng { text, language } (Bật chế độ SSE Stream thời gian thực cho Humzier GUI)
    else {
        const { text, language } = req.body;

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const sendSSE = (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        sendSSE({ status: 'info', message: 'Đã thiết lập luồng xử lý đặc vụ thông minh!' });

        let conversationHistory = [
            {
                role: 'system',
                content: `Bạn là một Đặc vụ AI tự động hóa (Autonomous AI Agent). Bạn có toàn quyền sử dụng công cụ để thực thi lệnh Terminal, xử lý tập tin (đọc/ghi), và tìm kiếm cực sâu trên 100 nguồn dữ liệu internet. Hãy phân tích bài toán và tự động phối hợp các công cụ để giải quyết trọn vẹn yêu cầu. Luôn phản hồi bằng ngôn ngữ: ${language || 'vi'}.`
            },
            { role: 'user', content: text }
        ];

        let toolCallCounter = 0;
        let iterations = 0;
        const LIMIT_ITERATIONS = 8;
        let finalResponseText = '';

        while (iterations < LIMIT_ITERATIONS) {
            iterations++;
            const currentThoughtStep = `Suy nghĩ Đặc vụ (Lần ${iterations})`;
            sendSSE({ status: 'step', step_name: currentThoughtStep, message: 'Đang phân tích chuỗi logic hành động...' });

            try {
                const apiResponse = await fetch(WORKER_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: MODEL_NAME,
                        messages: conversationHistory,
                        tools: agentTools,
                        tool_choice: "auto"
                    })
                });

                if (!apiResponse.ok) {
                    const errorText = await apiResponse.text();
                    throw new Error(`Worker Cloudflare báo lỗi: ${errorText}`);
                }

                const payload = await apiResponse.json();
                const aiMessage = payload.choices?.[0]?.message;

                if (!aiMessage) throw new Error("Không nhận được phản hồi hợp lệ từ mô hình.");

                conversationHistory.push(aiMessage);
                sendSSE({ status: 'step_complete', step_name: currentThoughtStep, message: aiMessage.content ? 'Đã tìm ra phương án tối ưu.' : 'Đang gọi công cụ phần cứng máy chủ.' });

                if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
                    finalResponseText = aiMessage.content || 'Đặc vụ đã hoàn thành tác vụ.';
                    break;
                }

                for (const tool of aiMessage.tool_calls) {
                    toolCallCounter++;
                    const toolName = tool.function.name;
                    let args = {};
                    try { args = JSON.parse(tool.function.arguments); } catch (e) { args = { raw: tool.function.arguments }; }

                    let toolStepName = `[Hành động ${toolCallCounter}] `;
                    let toolOutput = '';

                    if (toolName === 'execute_terminal') {
                        toolStepName += `Terminal Shell`;
                        sendSSE({ status: 'step', step_name: toolStepName, message: `Đang chạy lệnh shell: ${args.command}` });
                        const result = await runTerminalCommand(args.command);
                        toolOutput = JSON.stringify(result);
                        sendSSE({ status: 'step_complete', step_name: toolStepName, message: result.error ? `Lỗi terminal: ${result.error.slice(0, 50)}` : `Hoàn tất lệnh.` });

                    } else if (toolName === 'manage_file') {
                        const { action, filename, content } = args;
                        toolStepName += `${action === 'write' ? 'Ghi tệp' : 'Đọc tệp'} [${filename}]`;
                        sendSSE({ status: 'step', step_name: toolStepName, message: `Đang tương tác với tập tin ${filename}...` });
                        const targetFilePath = path.join(__dirname, filename);

                        if (action === 'write') {
                            fs.writeFileSync(targetFilePath, content || '', 'utf-8');
                            toolOutput = `Ghi tệp ${filename} thành công.`;
                        } else {
                            if (fs.existsSync(targetFilePath)) {
                                toolOutput = fs.readFileSync(targetFilePath, 'utf-8');
                            } else {
                                toolOutput = `Lỗi hệ thống: Không tìm thấy tệp tin ${filename}`;
                            }
                        }
                        sendSSE({ status: 'step_complete', step_name: toolStepName, message: `Thao tác lưu trữ hoàn thành.` });

                    } else if (toolName === 'deep_search') {
                        toolStepName += `Siêu tìm kiếm sâu`;
                        sendSSE({ status: 'step', step_name: toolStepName, message: `Đang thực hiện quét sâu mạng: "${args.query}"` });
                        const searchMeta = await performDeepSearch(args.query);
                        toolOutput = JSON.stringify(searchMeta);
                        sendSSE({ status: 'step_complete', step_name: toolStepName, message: `Đã liên kết và thu thập ${searchMeta.length} nguồn dữ liệu.` });
                    }

                    conversationHistory.push({
                        role: 'tool',
                        tool_call_id: tool.id,
                        name: toolName,
                        content: toolOutput
                    });
                }
            } catch (err) {
                sendSSE({ status: 'error', step_name: 'Lỗi Đặc Vụ', message: err.message });
                res.end();
                return;
            }
        }
        sendSSE({ status: 'complete', final_text: finalResponseText });
        res.end();
    }
}

// Áp dụng định tuyến song song cho cả hai Endpoint để triệt tiêu hoàn toàn lỗi 404/Cannot POST
app.post('/api/chat', handleAgentProcess);
app.post('/humanize', handleAgentProcess);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Hệ thống Web App Agent đang hoạt động ổn định tại port: ${PORT}`);
});
