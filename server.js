const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();

// Middleware để giải mã JSON gửi lên từ giao diện người dùng
app.use(express.json());

// Ánh xạ thư mục tĩnh "public" thành đường dẫn ảo "/static" khớp hoàn toàn với index.html
app.use('/static', express.static(path.join(__dirname, 'public')));

// Trả về giao diện index.html gốc khi truy cập trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Định nghĩa danh sách Công cụ (Tools) chuẩn OpenAI/OpenRouter cho Mô hình Nex-N2-Pro
const agentTools = [
    {
        type: "function",
        function: {
            name: "execute_terminal",
            description: "Thực thi các lệnh shell/terminal trực tiếp trên hệ thống máy chủ và thu về kết quả stdout/stderr.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "Lệnh shell cần chạy (ví dụ: 'npm install', 'ls -la', 'node app.js')." }
                },
                required: ["command"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "manage_file",
            description: "Đọc nội dung tệp tin hoặc tạo mới/ghi đè mã nguồn vào các tệp tin trong không gian làm việc cục bộ.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["write", "read"], description: "Hành động cụ thể: 'write' để ghi tệp hoặc 'read' để đọc tệp." },
                    filename: { type: "string", description: "Tên tệp tin cần xử lý (ví dụ: 'index.html', 'script.py', 'test.txt')." },
                    content: { type: "string", description: "Nội dung cần viết vào tệp (Bắt buộc phải điền nếu chọn hành động 'write')." }
                },
                required: ["action", "filename"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "deep_search",
            description: "Kích hoạt chức năng tìm kiếm mạng siêu sâu, thu thập và gom dữ liệu từ hơn 100 nguồn web khác nhau để phục vụ nghiên cứu diện rộng.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Từ khóa hoặc truy vấn tìm kiếm chuyên sâu nâng cao." }
                },
                required: ["query"]
            }
        }
    }
];

// Hàm thực thi dòng lệnh terminal vật lý với cơ chế timeout an toàn
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

// Hàm Tìm kiếm siêu sâu, quét phân trang đồng thời thu về ~100-130 nguồn link độc lập
async function performDeepSearch(query) {
    const aggregatedResults = [];
    const pages = [0, 30, 60, 90, 120]; // Duyệt qua nhiều trang để cào sâu dữ liệu

    for (const offset of pages) {
        try {
            const targetUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${offset}`;
            const response = await fetch(targetUrl, {
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
            });
            if (!response.ok) continue;
            
            const htmlText = await response.text();
            // Regex bóc tách nội dung trích đoạn snippet và link liên kết
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

            // Phương án dự phòng cào thẻ URL nếu giao diện DuckDuckGo thay đổi cấu trúc
            if (itemsFound === 0) {
                const urlMatches = htmlText.matchAll(/<a class="result__url"[^>]*href="([^"]+)"[^>]*>/g);
                for (const match of urlMatches) {
                    let fallbackUrl = match[1];
                    if (fallbackUrl.includes("uddg=")) fallbackUrl = decodeURIComponent(fallbackUrl.split("uddg=")[1].split("&")[0]);
                    if (!aggregatedResults.some(res => res.url === fallbackUrl)) {
                        aggregatedResults.push({ url: fallbackUrl, snippet: "Nguồn dữ liệu chuyên sâu bổ sung từ Agent." });
                    }
                }
            }
        } catch (err) {
            console.error(`Lỗi quét sâu tại offset mạng ${offset}:`, err.message);
        }
    }
    return aggregatedResults.slice(0, 130); // Giới hạn mốc tối đa quanh 100-130 nguồn để tối ưu token hành hạ
}

// Endpoint điều phối Đặc vụ thông minh theo chuẩn Stream của app.js
app.post('/humanize', async (req, res) => {
    try {
        const { text, language } = req.body;

        // Bật cấu hình truyền dữ liệu thời gian thực (SSE Stream) tương thích tuyệt đối với app.js
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const sendSSE = (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        // Gói tin khởi tạo ban đầu gửi về cho app.js nhận diện kết nối
        sendSSE({ status: 'info', message: 'Đã kết nối Backend Node.js thành công!' });

        const WORKER_URL = "https://openrouter-api.dungtrantricreative.workers.dev/v1/chat/completions";
        const MODEL_NAME = "nex-agi/nex-n2-pro:free";

        // Thiết lập cấu trúc Prompt hệ thống định hình tư duy của một AI Agent tự trị
        let conversationHistory = [
            {
                role: 'system',
                content: `Bạn là một Đặc vụ AI tự động hóa (Autonomous AI Agent) siêu thông minh được tích hợp trực tiếp vào hệ thống máy chủ. Bạn có toàn quyền sử dụng các công cụ được cung cấp để thực thi lệnh Terminal, quản lý file (đọc/ghi), và thực hiện tìm kiếm siêu sâu trên mạng Internet (>100 nguồn).
Hãy phân tích kỹ bài toán của người dùng, tự động lập kế hoạch hành động, tự sửa lỗi nếu lệnh gặp lỗi cú pháp hay thiếu thư viện, và kiên trì thực hiện cho đến khi ra được kết quả hoàn chỉnh cuối cùng.
Lưu ý quan trọng: Luôn phản hồi nội dung văn bản cuối cùng bằng ngôn ngữ được chỉ định (Mã ngôn ngữ hiện tại của người dùng chọn: ${language || 'vi'}).`
            },
            {
                role: 'user',
                content: text
            }
        ];

        let toolCallCounter = 0;
        let iterations = 0;
        const LIMIT_ITERATIONS = 8; // Vòng lặp suy nghĩ (Agent Loop) tối đa để tránh loop vô hạn
        let finalResponseText = '';

        while (iterations < LIMIT_ITERATIONS) {
            iterations++;
            
            // Đồng bộ trạng thái suy nghĩ của mô hình lên danh sách Steps ở giao diện
            const currentThoughtStep = `Suy nghĩ Đặc vụ (Lần ${iterations})`;
            sendSSE({ 
                status: 'step', 
                step_name: currentThoughtStep, 
                message: 'Đang gửi chuỗi dữ liệu phân tích yêu cầu sang Nex-N2-Pro...' 
            });

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
                throw new Error(`Cloudflare Worker báo lỗi hệ thống (${apiResponse.status}): ${errorText}`);
            }

            const payload = await apiResponse.json();
            const aiMessage = payload.choices?.[0]?.message;

            if (!aiMessage) {
                throw new Error("Không nhận được cấu trúc phản hồi hợp lệ từ hạ tầng AI.");
            }

            // Ghi nhận phản hồi hiện tại của mô hình vào lịch sử hội thoại toàn cục
            conversationHistory.push(aiMessage);

            // Hoàn tất bước suy nghĩ hiện tại trên giao diện (Đổi sang tích xanh)
            sendSSE({ 
                status: 'step_complete', 
                step_name: currentThoughtStep, 
                message: aiMessage.content ? 'Đã phân tích xong giải pháp.' : 'Đặc vụ quyết định gọi công cụ hệ thống.' 
            });

            // Nếu mô hình trả về nội dung trực tiếp bằng chữ và không yêu cầu gọi công cụ nữa -> Hoàn thành chu trình
            if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
                finalResponseText = aiMessage.content || 'Đặc vụ đã xử lý xong toàn bộ chu trình tác vụ.';
                break;
            }

            // Vòng lặp bóc tách và thực thi tuần tự các cuộc gọi công cụ do mô hình chỉ định
            for (const tool of aiMessage.tool_calls) {
                toolCallCounter++;
                const toolName = tool.function.name;
                let args = {};
                try {
                    args = JSON.parse(tool.function.arguments);
                } catch (e) {
                    args = { raw: tool.function.arguments };
                }

                // Đảm bảo mỗi lần gọi công cụ tạo ra 1 dòng trạng thái riêng biệt, trực quan trên app.js bằng cách đổi tên step_name liên tục
                let toolStepName = `[Hành động ${toolCallCounter}] `;
                let toolOutput = '';

                if (toolName === 'execute_terminal') {
                    toolStepName += `Terminal Shell`;
                    sendSSE({ status: 'step', step_name: toolStepName, message: `Đang chạy lệnh: ${args.command}` });

                    const result = await runTerminalCommand(args.command);
                    toolOutput = JSON.stringify(result);

                    sendSSE({ 
                        status: 'step_complete', 
                        step_name: toolStepName, 
                        message: result.error ? `Lỗi thực thi shell: ${result.error.slice(0, 80)}` : `Hoàn tất. Output: ${result.output.slice(0, 80)}...` 
                    });

                } else if (toolName === 'manage_file') {
                    const { action, filename, content } = args;
                    toolStepName += `${action === 'write' ? 'Ghi file' : 'Đọc file'} [${filename}]`;
                    sendSSE({ status: 'step', step_name: toolStepName, message: `Đang truy xuất tập tin ${filename}...` });

                    const targetFilePath = path.join(__dirname, filename);
                    if (action === 'write') {
                        fs.writeFileSync(targetFilePath, content || '', 'utf-8');
                        toolOutput = `Đặc vụ đã khởi tạo và ghi đè dữ liệu vào tệp ${filename} thành công.`;
                    } else {
                        if (fs.existsSync(targetFilePath)) {
                            toolOutput = fs.readFileSync(targetFilePath, 'utf-8');
                        } else {
                            toolOutput = `Lỗi hệ thống: Không tìm thấy tệp tin '${filename}' trong không gian làm việc cục bộ.`;
                        }
                    }

                    sendSSE({ status: 'step_complete', step_name: toolStepName, message: `Thao tác lưu trữ tệp hoàn thành.` });

                } else if (toolName === 'deep_search') {
                    toolStepName += `Siêu tìm kiếm sâu`;
                    sendSSE({ status: 'step', step_name: toolStepName, message: `Đang cào quét từ khóa: "${args.query}"` });

                    const searchMeta = await performDeepSearch(args.query);
                    toolOutput = JSON.stringify(searchMeta);

                    sendSSE({ 
                        status: 'step_complete', 
                        step_name: toolStepName, 
                        message: `Đặc vụ đã quét sâu và lọc thành công ${searchMeta.length} nguồn tài liệu độc lập.` 
                    });
                }

                // Đồng bộ kết quả phản hồi của Công cụ vào chuỗi hội thoại gửi lại cho AI suy nghĩ tiếp ở lượt kế tiếp
                conversationHistory.push({
                    role: 'tool',
                    tool_call_id: tool.id,
                    name: toolName,
                    content: toolOutput
                });
            }
        }

        // Bước cuối cùng: Đẩy toàn bộ văn bản phản hồi tổng hợp mượt mà vào bong bóng chat AI
        sendSSE({ status: 'complete', final_text: finalResponseText });
        res.end();

    } catch (error) {
        console.error("Lỗi xảy ra trong vòng lặp Đặc vụ:", error);
        sendSSE({ status: 'error', step_name: 'Hệ thống', message: error.message });
        res.end();
    }
});

// Lắng nghe cổng mạng tự động đồng bộ theo cơ chế nền tảng Render.com
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Hệ thống lõi Đặc vụ Autonomous Agent hoạt động trơn tru tại port: ${PORT}`);
});
