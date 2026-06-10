const express = require('express');
const path = require('path');
const app = express();

// 1. Cho phép Express đọc dữ liệu JSON gửi lên từ app.js
app.use(express.json());

// 2. Sửa lỗi 404: Biến thư mục "public" trên GitHub thành đường dẫn "/static" trên web
app.use('/static', express.static(path.join(__dirname, 'public')));

// 3. Phục vụ trang chủ index.html khi truy cập web
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 4. Sửa lỗi "Cannot POST /humanize": Tiếp nhận yêu cầu khi bấm nút "Thực hiện"
app.post('/humanize', async (req, res) => {
    try {
        const { text, language } = req.body;

        // Thiết lập Header để truyền dữ liệu dạng hiển thị từng chữ (Stream)
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Gửi các bước xử lý ban đầu về giao diện (để UI sáng đèn xanh)
        res.write(`data: ${JSON.stringify({ status: 'info', message: 'Đã kết nối Backend Node.js...' })}\n\n`);
        res.write(`data: ${JSON.stringify({ status: 'step', step_name: 'Xử lý Đặc vụ', message: 'Đang gửi văn bản tới AI...' })}\n\n`);

        // --- KẾT NỐI SANG CLOUDFLARE WORKER CỦA BẠN ---
        // Thay đường dẫn bên dưới bằng URL Cloudflare Worker thực tế của bạn (file index.js proxy OpenRouter)
        const workerUrl = 'https://openrouter-api.YOUR_SUBDOMAIN.workers.dev/v1/chat/completions'; 
        
        const aiResponse = await fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Nếu Worker của bạn yêu cầu Authorization từ client thì truyền ở đây, không thì thôi vì Worker đã tự quét Key rồi
            },
            body: JSON.stringify({
                model: 'google/gemini-2.5-flash', // Hoặc model bạn muốn chạy
                messages: [
                    { role: 'system', content: `Bạn là chuyên gia viết lại văn bản bằng ngôn ngữ: ${language}. Hãy làm cho nó tự nhiên nhất.` },
                    { role: 'user', content: text }
                ],
                stream: true // Kích hoạt stream từ OpenRouter
            })
        });

        // Đọc stream từ Cloudflare Worker và truyền thẳng về giao diện app.js
        const reader = aiResponse.body.getReader();
        const decoder = new TextDecoder();
        let done = false;

        while (!done) {
            const { value, done: doneReading } = await reader.read();
            done = doneReading;
            if (value) {
                const chunk = decoder.decode(value, { stream: !done });
                // Đẩy thẳng chunk dữ liệu stream về cho giao diện nhận
                res.write(chunk);
            }
        }

        res.end();
    } catch (error) {
        console.error("Lỗi Backend:", error);
        res.write(`data: ${JSON.stringify({ status: 'error', step_name: 'Xử lý Đặc vụ', message: error.message })}\n\n`);
        res.end();
    }
});

// Cấu hình PORT cho Render.com
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server đang chạy tại port ${PORT}`);
});
